import { _decorator, Component, Node, Vec3, tween, UIOpacity, isValid, AudioSource, AudioClip, UITransform } from 'cc';
import { StackOutline } from './stackOutline'; 

const { ccclass, property } = _decorator;

// 1. DEFINE LOCAL INTERFACES 
interface CardData {
    value: number;  // 0-12 (Ace-King)
    suit: number;   // 0-3
    isRed: boolean;
    node: Node;
}

// 2. DEFINE A "SHAPE" FOR THE COMPONENT 
interface CardLogicComponent extends Component {
    getCardData(node: Node): CardData | null;
    emptyStockVisual?: Node;
}

@ccclass('GameManager')
export class GameManager extends Component {

    // --- UI REFERENCES ---
    @property(Node) public introNode: Node = null!;
    @property(Node) public mainNode: Node = null!;
    @property(Node) public mainLabel: Node = null!;
    @property(Node) public ctaScreen: Node = null!;
    @property(Node) public globalOverlay: Node = null!;
    @property({ type: AudioClip }) public bgmClip: AudioClip = null!;

    // --- PILE REFERENCES ---
    @property({ type: [Node] }) public tableauNodes: Node[] = [];
    @property({ type: [Node] }) public foundationNodes: Node[] = [];
    @property({ type: Node }) public stockNode: Node = null!;
    @property({ type: Node }) public wasteNode: Node = null!;

    // --- AI HINT SYSTEM ---
    @property({ type: StackOutline })
    public stackOutline: StackOutline = null!; 

    @property({ tooltip: "Time in seconds before showing a hint" }) 
    public idleHintDelay: number = 5.0;

    // --- INTERNAL STATE ---
    private _audioSource: AudioSource = null!;
    private _gameWon: boolean = false;
    private _idleTimer: number = 0;
    private _isHintActive: boolean = false;

    // --- WIN CONDITION STATE ---
    private _totalHiddenCards: number = 21; // Standard Klondike Tableau (0+1+2+3+4+5+6 = 21)
    private _revealedCount: number = 0;

    onLoad() {
        this.initBGM();
        this.setupInitialState();
        this.startSequence();
    }

    update(dt: number) {
        if (!this._gameWon && !this._isHintActive && this.mainNode.active) {
            this._idleTimer += dt;
            if (this._idleTimer >= this.idleHintDelay) {
                console.log("[GameManager] ⏰ Idle Timer Triggered! Searching for hint...");
                this.showDynamicHint();
            }
        }
    }

    public resetIdleTimer() {
        if (this._idleTimer > 1.0) console.log("[GameManager] ⏳ Timer Reset by User Action.");
        this._idleTimer = 0;
        this.hideDynamicHint();
    }

    public addValidMove(clickedNode: Node) {
        this.resetIdleTimer();
        this.ensureAudioPlays();
        this.checkFoundationWinCondition(); // Keep checking foundations too just in case
    }

    // =========================================================================
    // 🧠 AI HINT LOGIC
    // =========================================================================

    private showDynamicHint() {
        console.log("[GameManager] 🔍 Starting findBestMove()...");
        const bestMove = this.findBestMove();

        if (bestMove) {
            this._isHintActive = true;
            console.log(`[GameManager] ✅ BEST MOVE FOUND: ${bestMove.type} on ${bestMove.from?.name}`);
            
            // SHOW STACK OUTLINE
            if (this.stackOutline && bestMove.from) {
                let cardCount = 1;
                
                // If moving a substack in Tableau, calculate how many cards are attached below it
                if (bestMove.type === 'TableauToTableau' && bestMove.from.parent) {
                    const children = bestMove.from.parent.children;
                    const index = children.indexOf(bestMove.from);
                    if (index !== -1) {
                        cardCount = children.length - index;
                    }
                }
                
                console.log(`[GameManager] 🟩 Showing Outline on ${bestMove.from.name} (Count: ${cardCount})`);
                this.stackOutline.show(bestMove.from, cardCount);
            }
        } else {
            console.log("[GameManager] 🤷 No Valid Moves Found.");
        }
    }

    private hideDynamicHint() {
        if (this.stackOutline) {
            this.stackOutline.clear();
        }
        this._isHintActive = false;
    }

    private findBestMove(): { type: string, from: Node, to?: Node } | null {
        // 1. TABLEAU -> FOUNDATION
        for (const tNode of this.tableauNodes) {
            const topCard = this.getTopCard(tNode);
            if (topCard) {
                const target = this.checkFoundationMoves(topCard).node;
                if (target) return { type: 'TableauToFoundation', from: topCard, to: target };
            }
        }

        // 2. TABLEAU -> TABLEAU
        for (let i = 0; i < this.tableauNodes.length; i++) {
            const pile = this.tableauNodes[i];
            const faceUpCards = pile.children.filter(c => c.active && c.name.startsWith("card"));
            if (faceUpCards.length === 0) continue;

            const pileLogic = pile.getComponent('CardLogic') as unknown as CardLogicComponent;

            for (const sourceCard of faceUpCards) {
                const cardData = pileLogic?.getCardData(sourceCard);
                if (cardData && cardData.value === 12) {
                    const hasHiddenCards = pile.children.some(c => c.active && c.name.includes("faceDown"));
                    if (!hasHiddenCards) continue; 
                }

                const target = this.checkTableauMoves(sourceCard, i);
                if (target) return { type: 'TableauToTableau', from: sourceCard, to: target };
            }
        }

        // 3. WASTE -> FOUNDATION
        const wasteTop = this.getTopCard(this.wasteNode);
        if (wasteTop) {
            const target = this.checkFoundationMoves(wasteTop).node;
            if (target) return { type: 'WasteToFoundation', from: wasteTop, to: target };
        }

        // 4. WASTE -> TABLEAU
        if (wasteTop) {
            const target = this.checkTableauMoves(wasteTop, -1);
            if (target) return { type: 'WasteToTableau', from: wasteTop, to: target };
        }

        // 5. STOCK CHECK
        const stockLogic = this.stockNode.getComponent('CardLogic') as unknown as CardLogicComponent;
        const stockCount = this.stockNode.children.filter(c => c.name.startsWith("card") || c.name.includes("faceDown")).length;

        if (stockCount > 0) return { type: 'DrawStock', from: this.stockNode };
        
        const wasteCount = this.wasteNode.children.filter(c => c.name.startsWith("card")).length;
        if (wasteCount > 0) {
            if (stockLogic && !stockLogic.emptyStockVisual?.active) {
                return { type: 'RestackStock', from: this.stockNode };
            }
        }

        return null;
    }

    // --- HELPERS ---

    private getTopCard(holder: Node): Node | null {
        if (!holder) return null;
        const cards = holder.children.filter(c => c.active && c.name.startsWith("card"));
        return cards.length > 0 ? cards[cards.length - 1] : null;
    }

    private checkFoundationMoves(cardNode: Node): { node: Node | null } {
        const cardLogic = cardNode.parent?.getComponent('CardLogic') as unknown as CardLogicComponent;
        const cardData = cardLogic?.getCardData(cardNode);
        if (!cardData) return { node: null };

        for (const fNode of this.foundationNodes) {
            const fLogic = fNode.getComponent('CardLogic') as unknown as CardLogicComponent;
            const fTop = this.getTopCard(fNode);
            
            if (!fTop) {
                if (cardData.value === 0) return { node: fNode }; 
            } else {
                const fData = fLogic?.getCardData(fTop);
                if (fData && fData.suit === cardData.suit && cardData.value === fData.value + 1) {
                    return { node: fNode };
                }
            }
        }
        return { node: null };
    }

    private checkTableauMoves(cardNode: Node, ignoreIndex: number): Node | null {
        const cardLogic = cardNode.parent?.getComponent('CardLogic') as unknown as CardLogicComponent;
        const cardData = cardLogic?.getCardData(cardNode);
        if (!cardData) return null;

        for (let i = 0; i < this.tableauNodes.length; i++) {
            if (i === ignoreIndex) continue;

            const tNode = this.tableauNodes[i];
            const tLogic = tNode.getComponent('CardLogic') as unknown as CardLogicComponent;
            const tTop = this.getTopCard(tNode);

            if (!tTop) {
                if (cardData.value === 12) return tNode;
            } else {
                const tData = tLogic?.getCardData(tTop);
                if (tData) {
                    const isOppositeColor = tData.isRed !== cardData.isRed;
                    const isRankOneLower = tData.value === cardData.value + 1; 
                    if (isOppositeColor && isRankOneLower) return tNode;
                }
            }
        }
        return null;
    }

    // =========================================================================
    // 🏆 WIN CONDITION LOGIC
    // =========================================================================

    /**
     * Called by CardFlipper.ts whenever a face-down card is flipped face-up.
     */
    public onCardRevealed() {
        this._revealedCount++;
        console.log(`[GameManager] 🔓 Card Revealed! Progress: ${this._revealedCount} / ${this._totalHiddenCards}`);

        if (this._revealedCount >= this._totalHiddenCards) {
            console.log("[GameManager] 🎉 ALL HIDDEN CARDS REVEALED! Triggering Win State.");
            this.triggerWinState();
        }
    }

    private checkFoundationWinCondition() {
        if (this._gameWon) return;
        let count = 0;
        this.foundationNodes.forEach(f => count += f.children.filter(c => c.name.startsWith("card")).length);
        if (count >= 52) {
            console.log("[GameManager] 🏆 FOUNDATIONS FULL! Triggering Win State.");
            this.triggerWinState();
        }
    }

    private triggerWinState() {
        if (this._gameWon) return;
        this._gameWon = true;

        this.hideDynamicHint();
        this.scheduleOnce(() => {
            this.showCTA();
        }, 0.5);
    }

    private showCTA() {
        if (!this.ctaScreen || this.ctaScreen.active) return;
        
        this.ctaScreen.active = true;
        
        // --- 🔴 FIX: SAFELY GET OR ADD UIOPACITY ---
        const op = this.ctaScreen.getComponent(UIOpacity) || this.ctaScreen.addComponent(UIOpacity);
        op.opacity = 0;

        tween(op).to(0.3, { opacity: 255 }).start();
        
        this.ctaScreen.setScale(new Vec3(0, 0, 1));
        tween(this.ctaScreen)
            .to(0.5, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
            .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .call(() => this.playCTAPulse())
            .start();
    }
    
    private playCTAPulse() {
        if (!isValid(this.ctaScreen)) return;
        tween(this.ctaScreen).repeatForever(
            tween()
                .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
        ).start();
    }

    // =========================================================================
    // ⚙️ STANDARD SETUP & AUDIO
    // =========================================================================

    private initBGM() {
        if (!this.bgmClip) return;
        this._audioSource = this.node.getComponent(AudioSource) || this.node.addComponent(AudioSource);
        this._audioSource.clip = this.bgmClip;
        this._audioSource.loop = true;
        this._audioSource.playOnAwake = true;
        this._audioSource.volume = 0.5;
        this._audioSource.play();
    }

    private ensureAudioPlays() { 
        if (this._audioSource && !this._audioSource.playing) this._audioSource.play(); 
    }
    
    private setupInitialState() {
        if (this.mainNode) this.mainNode.active = false;
        
        if (this.ctaScreen) {
            this.ctaScreen.active = false;
            // Pre-add opacity to avoid issues
            if (!this.ctaScreen.getComponent(UIOpacity)) this.ctaScreen.addComponent(UIOpacity);
        }
        
        if (this.stackOutline) this.stackOutline.clear();
    }
    
    private startSequence() {
        if (this.introNode) {
            this.introNode.active = true;
            this.scheduleOnce(() => {
                 tween(this.introNode.getComponent(UIOpacity) || this.introNode.addComponent(UIOpacity))
                 .to(0.5, {opacity:0})
                 .call(()=>{ this.introNode.active=false; this.startGameLogic(); }).start();
            }, 1.0);
        } else { this.startGameLogic(); }
    }
    
    private startGameLogic() {
        if (this.mainNode) {
            this.mainNode.active = true;
            tween(this.mainNode.getComponent(UIOpacity) || this.mainNode.addComponent(UIOpacity)).to(0.5, {opacity: 255}).start();
        }
    }
}