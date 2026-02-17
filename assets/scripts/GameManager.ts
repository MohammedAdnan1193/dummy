import { _decorator, Component, Node, Vec3, tween, UIOpacity, isValid, AudioSource, AudioClip, UITransform, Label, CCInteger, Color } from 'cc';
import { StackOutline } from './stackOutline'; 
// REMOVED: import { CardLogic } from './CardLogic'; to prevent Circular Dependency

const { ccclass, property } = _decorator;

// 1. DEFINE LOCAL INTERFACES (Duck Typing)
// We define the shape of CardLogic here so we don't need to import the actual file.
interface CardData {
    value: number;  
    suit: number;   
    isRed: boolean;
    node: Node;
}

interface CardLogicComponent extends Component {
    getCardData(node: Node): CardData | null;
    emptyStockVisual?: Node;
}

// 2. DEFINE STRATEGIC MOVE INTERFACE
interface StrategicMove {
    type: string;
    from: Node;
    to?: Node;
    score: number;
}

@ccclass('GameManager')
export class GameManager extends Component {

    // --- UI REFERENCES ---
    @property(Node) public introNode: Node = null!;
    @property(Node) public mainNode: Node = null!;
    @property(Node) public ctaScreen: Node = null!;       // WIN SCREEN
    @property(Node) public youLostScreen: Node = null!;   // LOSE SCREEN
    @property(Node) public globalOverlay: Node = null!;
    @property({ type: AudioClip }) public bgmClip: AudioClip = null!;

    // --- MOVES SYSTEM ---
    @property({ type: Label, tooltip: "Label to display remaining moves" }) 
    public movesLabel: Label = null!;

    @property({ type: CCInteger, tooltip: "Maximum number of moves allowed before losing" }) 
    public maxMoves: number = 50;

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
    private _gameOver: boolean = false; 
    private _idleTimer: number = 0;
    private _isHintActive: boolean = false;
    private _currentMoves: number = 0;   

    // --- WIN CONDITION STATE ---
    private _totalHiddenCards: number = 21; 
    private _revealedCount: number = 0;

    onLoad() {
        this.initBGM();
        this.setupInitialState();
        this.startSequence();
    }

    update(dt: number) {
        if (!this._gameWon && !this._gameOver && !this._isHintActive && this.mainNode.active) {
            this._idleTimer += dt;
            if (this._idleTimer >= this.idleHintDelay) {
                this.showDynamicHint();
            }
        }
    }

    public resetIdleTimer() {
        if (this._idleTimer > 1.0) console.log("[GameManager] ⏳ Timer Reset by User Action.");
        this._idleTimer = 0;
        this.hideDynamicHint();
    }

    // -------------------------------------------------------------------------
    // 🎮 MOVE HANDLER
    // -------------------------------------------------------------------------
    public addValidMove(clickedNode: Node) {
        if (this._gameWon || this._gameOver) return;

        this.resetIdleTimer();
        this.ensureAudioPlays();

        // 1. Decrease Moves
        this._currentMoves--;
        this.updateMovesLabel();

        // 2. Check Lose Condition
        if (this._currentMoves <= 0) {
            console.log("[GameManager] 💀 MOVES RAN OUT! Triggering Lose State.");
            this.triggerLoseState();
            return;
        }

        // 3. Check Win Condition
        this.checkFoundationWinCondition(); 
    }

    private updateMovesLabel() {
        if (this.movesLabel) {
            this.movesLabel.string = `${this._currentMoves}`;
            
            // FIXED: Use standard Color class
            // if (this._currentMoves <= 5) {
            //     this.movesLabel.color = new Color(255, 0, 0, 255);
            // } else {
            //     this.movesLabel.color = new Color(255, 255, 255, 255);
            // }
        }
    }

    private triggerLoseState() {
        if (this._gameWon || this._gameOver) return;
        this._gameOver = true;
        
        this.hideDynamicHint();
        this.scheduleOnce(() => { this.showYouLostScreen(); }, 0.5);
    }

    private showYouLostScreen() {
        if (!this.youLostScreen) return;
        
        this.youLostScreen.active = true;
        const op = this.youLostScreen.getComponent(UIOpacity) || this.youLostScreen.addComponent(UIOpacity);
        op.opacity = 0;
        
        tween(op).to(0.5, { opacity: 255 }).start();

        this.youLostScreen.setScale(new Vec3(0, 0, 1));
        tween(this.youLostScreen)
            .to(0.5, { scale: new Vec3(1.1, 1.1, 1) }, { easing: 'backOut' })
            .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .start();
    }

    // =========================================================================
    // 🧠 AI HINT LOGIC 
    // =========================================================================

    private showDynamicHint() {
        const bestMove = this.findBestMove();

        if (bestMove) {
            this._isHintActive = true;
            if (this.stackOutline && bestMove.from) {
                let cardCount = 1;
                if (bestMove.from.parent && this.tableauNodes.indexOf(bestMove.from.parent) !== -1){
                    const children = bestMove.from.parent.children;
                    const index = children.indexOf(bestMove.from);
                    if (index !== -1) {
                        cardCount = children.length - index;
                    }
                }
                this.stackOutline.show(bestMove.from, cardCount);
            }
        }
    }

    private hideDynamicHint() {
        if (this.stackOutline) {
            this.stackOutline.clear();
        }
        this._isHintActive = false;
    }

    private findBestMove(): StrategicMove | null {
        const allMoves: StrategicMove[] = [];

        // 1. SCAN TABLEAU MOVES
        for (let i = 0; i < this.tableauNodes.length; i++) {
            const pile = this.tableauNodes[i];
            const faceUpCards = pile.children.filter(c => c.active && c.name.startsWith("card"));
            
            if (faceUpCards.length === 0) continue;

            for (const sourceCard of faceUpCards) {
                // A. Check Foundation
                if (sourceCard === faceUpCards[faceUpCards.length - 1]) {
                    const fTarget = this.checkFoundationMoves(sourceCard).node;
                    if (fTarget) {
                        allMoves.push({ type: 'TableauToFoundation', from: sourceCard, to: fTarget, score: 100 });
                    }
                }

                // B. Check Tableau Transfer
                const tTarget = this.checkTableauMoves(sourceCard, i);
                if (tTarget) {
                    const siblingIndex = sourceCard.getSiblingIndex();
                    
                    const cardBelow = pile.children[siblingIndex - 1];
                    const isRevealing = cardBelow && cardBelow.name.includes("faceDown");

                    const isBottomCard = (siblingIndex === 1);
                    const isTargetNonEmpty = tTarget.children.length > 1;
                    const isClearSlotMove = isBottomCard && isTargetNonEmpty;

                    if (isRevealing) {
                        allMoves.push({ type: 'RevealHiddenCard', from: sourceCard, to: tTarget, score: 90 });
                    } 
                    else if (isClearSlotMove) {
                        allMoves.push({ type: 'ClearTableauSlot', from: sourceCard, to: tTarget, score: 50 });
                    } 
                    else {
                        allMoves.push({ type: 'TableauReposition', from: sourceCard, to: tTarget, score: 10 });
                    }
                }
            }
        }

        // 2. SCAN WASTE MOVES
        const wasteTop = this.getTopCard(this.wasteNode);
        if (wasteTop) {
            const fTarget = this.checkFoundationMoves(wasteTop).node;
            if (fTarget) {
                allMoves.push({ type: 'WasteToFoundation', from: wasteTop, to: fTarget, score: 80 });
            }

            const tTarget = this.checkTableauMoves(wasteTop, -1);
            if (tTarget) {
                allMoves.push({ type: 'WasteToTableau', from: wasteTop, to: tTarget, score: 60 });
            }
        }

        // 3. SCAN STOCK MOVES
        const stockCount = this.stockNode.children.filter(c => c.name.startsWith("card") || c.name.includes("faceDown")).length;
        
        if (stockCount > 0) {
            allMoves.push({ type: 'DrawStock', from: this.stockNode, score: 40 });
        } else {
            // FIXED: Cast to local interface instead of imported Class
            const stockLogic = this.stockNode.getComponent('CardLogic') as unknown as CardLogicComponent;
            const wasteCount = this.wasteNode.children.filter(c => c.name.startsWith("card")).length;
            
            if (wasteCount > 0 && stockLogic && !stockLogic.emptyStockVisual?.active) {
                allMoves.push({ type: 'RestackStock', from: this.stockNode, score: 40 });
            }
        }

        if (allMoves.length === 0) return null;
        allMoves.sort((a, b) => b.score - a.score);
        return allMoves[0];
    }

    // --- HELPERS ---

    private getTopCard(holder: Node): Node | null {
        if (!holder) return null;
        const cards = holder.children.filter(c => c.active && c.name.startsWith("card"));
        return cards.length > 0 ? cards[cards.length - 1] : null;
    }

    private checkFoundationMoves(cardNode: Node): { node: Node | null } {
        // FIXED: Cast to local interface
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
        // FIXED: Cast to local interface
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

    public onCardRevealed() {
        this._revealedCount++;
        console.log(`[GameManager] 🔓 Card Revealed! Progress: ${this._revealedCount} / ${this._totalHiddenCards}`);

        if (this._revealedCount >= this._totalHiddenCards) {
            this.triggerWinState();
        }
    }

    private checkFoundationWinCondition() {
        if (this._gameWon || this._gameOver) return;
        let count = 0;
        this.foundationNodes.forEach(f => count += f.children.filter(c => c.name.startsWith("card")).length);
        if (count >= 52) {
            this.triggerWinState();
        }
    }

    private triggerWinState() {
        if (this._gameWon || this._gameOver) return;
        this._gameWon = true;

        this.hideDynamicHint();
        this.scheduleOnce(() => { this.showCTA(); }, 0.5);
    }

    private showCTA() {
        if (!this.ctaScreen || this.ctaScreen.active) return;
        this.ctaScreen.active = true;
        
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
    // ⚙️ STANDARD SETUP
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
            if (!this.ctaScreen.getComponent(UIOpacity)) this.ctaScreen.addComponent(UIOpacity);
        }

        if (this.youLostScreen) {
            this.youLostScreen.active = false;
            if (!this.youLostScreen.getComponent(UIOpacity)) this.youLostScreen.addComponent(UIOpacity);
        }

        this._currentMoves = this.maxMoves;
        this.updateMovesLabel();

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