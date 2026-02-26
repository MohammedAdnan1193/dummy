import { _decorator, Component, Node, Vec3, tween, UIOpacity, isValid, AudioSource, AudioClip, UITransform, Label, CCInteger, Color, Prefab, instantiate, Sprite, math, view, SpriteFrame, sys } from 'cc';
import { StackOutline } from './stackOutline'; 

const { ccclass, property } = _decorator;

// --- 1. INTERFACES ---
interface CardData {
    value: number;  
    suit: number;   
    isRed: boolean;
    node: Node;
}

interface CardLogicComponent extends Component {
    getCardData(node: Node): CardData | null;
    visualDeckTop?: Node;
    emptyStockVisual?: Node;
    placeholderNode?: Node;
    setHighlightState?(isActive: boolean): void;
}

interface StrategicMove {
    type: string;
    from: Node;
    to?: Node;
    score: number;
}

interface CardAnimationData {
    node: Node;
    originalY: number;
    originalX: number;
    originalZ: number;
    column: number;
    row: number;
}

interface PeriodicScalerComponent extends Component {
    startPulsing(): void;
    stopPulsing(): void;
}

interface DiagonalMoverComponent extends Component {
    startMovingAt(pos: Vec3): void;
    stopMoving(): void;
}

@ccclass('GameManager')
export class GameManager extends Component {

    // --- TIMED POPUP & DOWNLOAD BUTTONS ---
    @property({ type: Node, tooltip: "Node to display as a popup" }) 
    public timePopupNode: Node = null!;
    
    @property({ type: CCInteger, tooltip: "Time in seconds before the popup appears" }) 
    public popupDelaySeconds: number = 15;
    
    @property({ type: Node }) 
    public downloadBtnPortrait: Node = null!;
    
    @property({ type: Node }) 
    public downloadBtnLandscape: Node = null!;

    // --- UI REFERENCES ---
    @property(Node) public introNode: Node = null!;
    @property(Node) public mainNode: Node = null!;
    @property(Node) public ctaScreen: Node = null!;       
    @property(Node) public youLostScreen: Node = null!;   
    @property(Node) public globalOverlay: Node = null!;
    @property({ type: AudioClip }) public bgmClip: AudioClip = null!;
    @property({ type: AudioClip }) public cardDropSound: AudioClip = null!;

    // --- AUDIO UI REFERENCES ---
    @property({ type: Node, tooltip: "The node containing the mute button" }) 
    public muteButtonNode: Node = null!;

    @property({ type: SpriteFrame, tooltip: "Icon when sound is ON" })
    public soundOnSprite: SpriteFrame = null!;

    @property({ type: SpriteFrame, tooltip: "Icon when sound is OFF" })
    public soundOffSprite: SpriteFrame = null!;

    // --- CONFETTI ANIMATION REFERENCES ---
    @property({ type: Prefab, tooltip: "Prefab for the confetti particles" })
    public confettiPrefab: Prefab = null!;
    
    @property({ type: Node, tooltip: "Container node to hold instantiated confetti" })
    public confettiContainer: Node = null!;

    // --- APP STORE REDIRECT & TIMER ---
    @property({ tooltip: "The App Store or Play Store URL" })
    public appStoreURL: string = "https://play.google.com/store/apps/details?id=com.felicitygames.yourgame";

    @property({ type: CCInteger, tooltip: "Seconds until the game auto-redirects to the store" })
    public autoRedirectInterval: number = 30;

    @property({ type: Label, tooltip: "Visual timer text label" })
    public timerLabel: Label = null!;

    // --- MOVES SYSTEM ---
    @property({ type: Label }) public movesLabel: Label = null!;
    @property({ type: CCInteger }) public maxMoves: number = 50;

    // --- PILE REFERENCES ---
    @property({ type: [Node] }) public tableauNodes: Node[] = [];
    @property({ type: [Node] }) public foundationNodes: Node[] = [];
    @property({ type: Node }) public stockNode: Node = null!;
    @property({ type: Node }) public wasteNode: Node = null!;

    // --- AI HINT SYSTEM ---
    @property({ type: StackOutline }) public stackOutline: StackOutline = null!; 
    @property public idleHintDelay: number = 5.0;

    @property({ type: Node, tooltip: "The pointing hand node for hints" }) 
    public hintHandNode: Node = null!;

    // --- INTERNAL STATE ---
    private _audioSource: AudioSource = null!;
    private _gameWon: boolean = false;
    private _gameOver: boolean = false; 
    private _isAutoPlaying: boolean = false; 
    private _idleTimer: number = 0;
    private _isHintActive: boolean = false;
    private _currentMoves: number = 0;   
    private _totalHiddenCards: number = 15; 
    private _revealedCount: number = 0;
    private _animationComplete: boolean = false; 
    
    private _redirectTimer: number = 0;
    private _isTimerRunning: boolean = false;

    public get isAnimationComplete(): boolean {
        return this._animationComplete;
    }
    private _isMuted: boolean = false;
    private _startafter: number = 3;

    onLoad() {
        this.initBGM();
        this.setupInitialState();
        this.startSequence();
    }

    start() {
        this.stopDownloadButtonsPulse();
    }

    update(dt: number) {
        // 1. Existing Idle Hint Logic
        if (!this._gameWon && !this._gameOver && !this._isHintActive && !this._isAutoPlaying && 
            this.mainNode.active && this._animationComplete) {
            this._idleTimer += dt;
            if (this._idleTimer >= this.idleHintDelay) {
                this.showDynamicHint();
            }
        }

        // 2. Text-Based Periodic Timer Logic
        if (this._isTimerRunning && !this._gameWon && !this._gameOver && this._animationComplete) {
            this._redirectTimer += dt;
            
            // Calculate how much time is left
            const timeLeft = Math.max(0, this.autoRedirectInterval - this._redirectTimer);
            
            // Update the text label (e.g., "30", "29", etc.)
            if (this.timerLabel) {
                this.timerLabel.string = `${Math.ceil(timeLeft)}`; 
            }

            // Trigger redirect and reset loop when time is up
            if (this._redirectTimer >= this.autoRedirectInterval) {
                this.triggerPeriodicRedirect();
            }
        }
    }

    private triggerPeriodicRedirect() {
        // Reset the timer state to start the 30 seconds over again
        this._redirectTimer = 0;
        if (this.timerLabel) {
            this.timerLabel.string = `${this.autoRedirectInterval}`;
        }

        console.log(`[GameManager] Periodic ${this.autoRedirectInterval}s Redirect to App Store!`);
        sys.openURL(this.appStoreURL);
    }

    public resetIdleTimer() {
        if (this._isAutoPlaying) return; 
        this._idleTimer = 0;
        this.hideDynamicHint();
    }

    public addValidMove(clickedNode: Node) {
        if (this._gameWon || this._gameOver || this._isAutoPlaying || !this._animationComplete) return;

        this.resetIdleTimer();
        this.ensureAudioPlays();

        this._currentMoves--;
        this.updateMovesLabel();

        // Calculate moves made and trigger the pulse at exactly 3 moves
        const movesMade = this.maxMoves - this._currentMoves;
        if (movesMade === this._startafter) {
            this.startDownloadButtonsPulse();
        }

        if (this._currentMoves <= 0) {
            this.triggerLoseState();
            return;
        }

        this.checkFoundationWinCondition(); 
    }

    // =========================================================================
    // ⏱️ TIMED POPUP LOGIC
    // =========================================================================

    private stopDownloadButtonsPulse() {
        const buttons = [this.downloadBtnPortrait, this.downloadBtnLandscape];
        buttons.forEach(btn => {
            if (isValid(btn)) {
                const scaler = btn.getComponent('PeriodicScaler') as unknown as PeriodicScalerComponent;
                if (scaler) {
                    scaler.stopPulsing();
                    btn.setScale(new Vec3(1, 1, 1)); 
                }
            }
        });
    }

    private startDownloadButtonsPulse() {
        const buttons = [this.downloadBtnPortrait, this.downloadBtnLandscape];
        buttons.forEach(btn => {
            if (isValid(btn)) {
                const scaler = btn.getComponent('PeriodicScaler') as unknown as PeriodicScalerComponent;
                if (scaler) {
                    scaler.startPulsing();
                }
            }
        });
    }

    private showTimePopup() {
        if (!this.timePopupNode || this._gameOver || this._gameWon) return;
        
        this.timePopupNode.active = true;
        const opacity = this.timePopupNode.getComponent(UIOpacity) || this.timePopupNode.addComponent(UIOpacity);
        opacity.opacity = 255;

        this.timePopupNode.setScale(new Vec3(0, 0, 1));

        tween(this.timePopupNode)
            .to(0.4, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
            .delay(3.0) 
            .call(() => {
                tween(opacity)
                    .to(0.4, { opacity: 0 })
                    .call(() => {
                        this.timePopupNode.active = false; 
                    })
                    .start();
            })
            .start();
    }

    // =========================================================================
    // 🎬 INITIAL CARD DROP ANIMATION
    // =========================================================================

    private startGameLogic() {
        if (this.mainNode) {
            this.mainNode.active = true;
            this.hideTableauCards();
            
            tween(this.mainNode.getComponent(UIOpacity) || this.mainNode.addComponent(UIOpacity))
                .to(0.3, { opacity: 255 })
                .call(() => {
                    this.animateCardsDropping();
                    this.scheduleOnce(() => {
                        this.showTimePopup();
                    }, this.popupDelaySeconds);
                })
                .start();
        }
    }

    private hideTableauCards() {
        this.tableauNodes.forEach((pile) => {
            const cardLogic = pile.getComponent('CardLogic') as unknown as CardLogicComponent;
            const cardNodes = pile.children.filter(c => 
                c.active && 
                c !== cardLogic?.placeholderNode &&
                (c.name.startsWith("card") || c.name.includes("faceDown"))
            );
            
            cardNodes.forEach((card) => {
                const opacity = card.getComponent(UIOpacity) || card.addComponent(UIOpacity);
                opacity.opacity = 0; 
            });
        });
    }

    private animateCardsDropping() {
        const cardAnimations: CardAnimationData[] = [];
        const stockWorldPos = this.stockNode.getWorldPosition();

        const originalStockScale = this.stockNode.getScale().clone();
        const originalWasteScale = this.wasteNode.getScale().clone();
        this.stockNode.setScale(new Vec3(0, 0, 1));
        this.wasteNode.setScale(new Vec3(0, 0, 1));

        this.tableauNodes.forEach((pile, columnIndex) => {
            const cardLogic = pile.getComponent('CardLogic') as unknown as CardLogicComponent;
            const cardNodes = pile.children.filter(c => 
                c.active && 
                c !== cardLogic?.placeholderNode &&
                (c.name.startsWith("card") || c.name.includes("faceDown"))
            );
            
            cardNodes.forEach((card, rowIndex) => {
                const finalPos = card.getPosition().clone(); 

                const transform = card.parent?.getComponent(UITransform);
                const localStart = transform ? transform.convertToNodeSpaceAR(stockWorldPos) : new Vec3(0,0,0);

                cardAnimations.push({
                    node: card,
                    originalX: finalPos.x,
                    originalY: finalPos.y,
                    originalZ: finalPos.z,
                    column: columnIndex,
                    row: rowIndex,
                    //@ts-ignore
                    startPos: localStart
                });
            });
        });

        cardAnimations.sort((a, b) => {
            if (a.column === b.column) return a.row - b.row;
            return a.column - b.column;
        });

        let maxDuration = 0;

        if (this._audioSource && this.cardDropSound) {
            this.scheduleOnce(() => {
                this._audioSource.playOneShot(this.cardDropSound, 0.3);
            }, 0.1); 
        }

        cardAnimations.forEach((data, index) => {
            const card = data.node;
            //@ts-ignore
            const startPos = data.startPos as Vec3;
            const endPos = new Vec3(data.originalX, data.originalY, data.originalZ);

            card.setPosition(startPos);
            card.setScale(new Vec3(0, 0, 1)); 
            card.angle = 180; 
            const opacity = card.getComponent(UIOpacity);
            if(opacity) opacity.opacity = 255;

            const midX = (startPos.x + endPos.x) / 2;
            const midY = (startPos.y + endPos.y) / 2 + 300; 
            const controlPos = new Vec3(midX, midY, 0);

            const delay = 0.1 + (index * 0.08); 
            const flightDuration = 0.6;
            maxDuration = Math.max(maxDuration, delay + flightDuration);

            const tweenObj = { t: 0 };
            
            tween(tweenObj)
                .delay(delay)
                .to(flightDuration, { t: 1 }, { 
                    easing: 'sineOut', 
                    onUpdate: (target: {t: number}) => {
                        const t = target.t;
                        
                        const u = 1 - t;
                        const tt = t * t;
                        const uu = u * u;

                        const x = (uu * startPos.x) + (2 * u * t * controlPos.x) + (tt * endPos.x);
                        const y = (uu * startPos.y) + (2 * u * t * controlPos.y) + (tt * endPos.y);
                        
                        card.setPosition(x, y, 0);
                        
                        card.angle = 180 - (180 * t); 
                        
                        const scaleAdd = 0.5 * (4 * t * (1 - t)); 
                        card.setScale(1 + scaleAdd, 1 + scaleAdd, 1);
                    }
                })
                .call(() => {
                    card.setPosition(endPos); 
                    card.angle = 0;
                    
                    tween(card)
                        .to(0.1, { scale: new Vec3(1.15, 0.85, 1) }) 
                        .to(0.1, { scale: new Vec3(1, 1, 1) })      
                        .start();
                })
                .start();
        });

        this.scheduleOnce(() => {
            this.popInNode(this.stockNode, originalStockScale);
            this.popInNode(this.wasteNode, originalWasteScale);
        }, maxDuration * 0.6);

        this.scheduleOnce(() => {
            this.playIntroSequence();
        }, maxDuration + 0.2);
    }

    private popInNode(node: Node, targetScale: Vec3) {
        if(!node) return;
        node.active = true;
        node.setScale(new Vec3(0,0,1));
        this.ensureCardsVisible(node); 
        tween(node)
            .to(0.4, { scale: targetScale }, { easing: 'elasticOut' })
            .start();
    }

    private ensureCardsVisible(pile: Node) {
        const cardLogic = pile.getComponent('CardLogic') as unknown as CardLogicComponent;
        const cards = pile.children.filter(c => 
            c.active && 
            c !== cardLogic?.placeholderNode &&
            c !== cardLogic?.visualDeckTop &&
            c !== cardLogic?.emptyStockVisual
        );
        
        cards.forEach((card) => {
            const opacity = card.getComponent(UIOpacity);
            if (opacity) {
                opacity.opacity = 255;
            }
        });
    }

    // =========================================================================
    // 🏆 AUTO WIN: OMNISCIENT SEARCH
    // =========================================================================

    public onCardRevealed() {
        if (this._isAutoPlaying) return;

        this._revealedCount++;
        console.log(`[GameManager] 🔓 Card Revealed! Progress: ${this._revealedCount} / ${this._totalHiddenCards}`);

        if (this._revealedCount >= this._totalHiddenCards) {
            console.log("[GameManager] 🎉 ALL HIDDEN CARDS REVEALED! Triggering Auto-Win Sequence...");
            this.startAutoWinSequence();
        }
    }

    private startAutoWinSequence() {
        if (this._isAutoPlaying) return;
        this._isAutoPlaying = true;
        this.hideDynamicHint();
        this.schedule(this.processNextAutoMove, 0.08);
    }

    private processNextAutoMove() {
        let cardMoved = false;
        const offset = Math.floor(Math.random() * 4); 

        for (let i = 0; i < 4; i++) {
            const fIndex = (i + offset) % 4; 
            const fNode = this.foundationNodes[fIndex];
            const neededCard = this.getNextNeededCard(fNode);
            
            if (neededCard) {
                const foundNode = this.findCardGlobally(neededCard.suit, neededCard.rank);
                if (foundNode) {
                    this.animateAutoMove(foundNode, fNode);
                    cardMoved = true;
                    break; 
                }
            }
        }

        let totalFoundationCards = 0;
        this.foundationNodes.forEach(f => totalFoundationCards += f.children.filter(c => c.name.startsWith("card")).length);

        if (totalFoundationCards >= 52) {
            this.unschedule(this.processNextAutoMove); 
            this.triggerWinState(); 
        } else if (!cardMoved && totalFoundationCards >= 52) {
             this.unschedule(this.processNextAutoMove);
             this.triggerWinState();
        }
    }

    private getNextNeededCard(foundationNode: Node): { suit: number, rank: number } | null {
        const topCard = this.getTopCard(foundationNode);
        if (!topCard) {
            const takenSuits = this.foundationNodes
                .map(f => this.getTopCard(f))
                .filter(c => c !== null)
                .map(c => Math.floor(parseInt(c!.name.replace("card", "")) / 13));

            for (let s = 0; s < 4; s++) {
                if (takenSuits.indexOf(s) === -1) return { suit: s, rank: 0 };
            }
            return null; 
        }
        const index = parseInt(topCard.name.replace("card", ""));
        const currentRank = index % 13;
        const currentSuit = Math.floor(index / 13);
        if (currentRank === 12) return null; 
        return { suit: currentSuit, rank: currentRank + 1 };
    }

    private findCardGlobally(targetSuit: number, targetRank: number): Node | null {
        const targetIndex = (targetSuit * 13) + targetRank;
        const paddedIndex = ("000" + targetIndex).slice(-3);
        const targetName = `card${paddedIndex}`;

        for (const pile of this.tableauNodes) {
            const match = pile.children.find(c => c.name === targetName);
            if (match) return match;
        }
        const wasteMatch = this.wasteNode.children.find(c => c.name === targetName);
        if (wasteMatch) return wasteMatch;
        const stockMatch = this.stockNode.children.find(c => c.name === targetName);
        if (stockMatch) return stockMatch;
        return null; 
    }

    private animateAutoMove(card: Node, target: Node) {
        const startWorld = card.getWorldPosition();
        card.setParent(target);
        card.setPosition(0, 0, 0); 
        card.setWorldPosition(startWorld);
        tween(card)
            .to(0.15, { position: new Vec3(0, 0, 0) }, { easing: 'sineOut' })
            .call(() => { card.setScale(1, 1, 1); })
            .start();
    }

    // =========================================================================
    // 🧠 AI HINT LOGIC 
    // =========================================================================

    private showDynamicHint() {
        if (!this._animationComplete) return;
        
        const bestMove = this.findBestMove();

        if (bestMove && bestMove.from) {
            this._isHintActive = true;
            
            if (this.stackOutline) {
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

            if (this.hintHandNode) {
                const mover = this.hintHandNode.getComponent('DiagonalMover') as unknown as DiagonalMoverComponent;
                if (mover) {
                    const cardWorldPos = bestMove.from.getWorldPosition();
                    const parentTransform = this.hintHandNode.parent?.getComponent(UITransform);
                    if (parentTransform) {
                        const localPos = parentTransform.convertToNodeSpaceAR(cardWorldPos);
                        localPos.x += 50; 
                        localPos.y += 50; 
                        mover.startMovingAt(localPos);
                    }
                }
            }
        }
    }

    private hideDynamicHint() {
        if (this.stackOutline) this.stackOutline.clear();
        
        if (this.hintHandNode) {
            const mover = this.hintHandNode.getComponent('DiagonalMover') as unknown as DiagonalMoverComponent;
            if (mover) mover.stopMoving();
        }
        
        this._isHintActive = false;
    }

    private findBestMove(): StrategicMove | null {
        const allMoves: StrategicMove[] = [];

        for (let i = 0; i < this.tableauNodes.length; i++) {
            const pile = this.tableauNodes[i];
            const faceUpCards = pile.children.filter(c => c.active && c.name.startsWith("card"));
            
            if (faceUpCards.length === 0) continue;

            for (const sourceCard of faceUpCards) {
                if (sourceCard === faceUpCards[faceUpCards.length - 1]) {
                    const fTarget = this.checkFoundationMoves(sourceCard).node;
                    if (fTarget) {
                        allMoves.push({ type: 'TableauToFoundation', from: sourceCard, to: fTarget, score: 100 });
                    }
                }

                const tTarget = this.checkTableauMoves(sourceCard, i);
                if (tTarget) {
                    const siblingIndex = sourceCard.getSiblingIndex();
                    const cardBelow = pile.children[siblingIndex - 1];
                    const isRevealing = cardBelow && cardBelow.name.includes("faceDown");
                    const isBottomCard = (siblingIndex === 1);
                    const isTargetNonEmpty = tTarget.children.length > 1;

                    if (isRevealing) {
                        allMoves.push({ type: 'RevealHiddenCard', from: sourceCard, to: tTarget, score: 90 });
                    } else if (isBottomCard && isTargetNonEmpty) {
                        allMoves.push({ type: 'ClearTableauSlot', from: sourceCard, to: tTarget, score: 50 });
                    } else {
                        allMoves.push({ type: 'TableauReposition', from: sourceCard, to: tTarget, score: 10 });
                    }
                }
            }
        }

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

        const stockCount = this.stockNode.children.filter(c => c.name.startsWith("card") || c.name.includes("faceDown")).length;
        if (stockCount > 0) {
            allMoves.push({ type: 'DrawStock', from: this.stockNode, score: 40 });
        } else {
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

    // --- HELPER METHODS ---
    private checkFoundationWinCondition() {
        if (this._gameWon || this._gameOver || this._isAutoPlaying) return;
        let count = 0;
        this.foundationNodes.forEach(f => count += f.children.filter(c => c.name.startsWith("card")).length);
        if (count >= 52) {
            console.log("[GameManager] Manual Win Triggered (52 Cards)");
            this.triggerWinState();
        }
    }

    public redirectToAppStore() {
        console.log(`[GameManager] Manual Redirecting to App Store: ${this.appStoreURL}`);
        sys.openURL(this.appStoreURL);
    }

    public toggleBGM() {
        this._isMuted = !this._isMuted;

        if (this._audioSource) {
            if (this._isMuted) {
                this._audioSource.pause(); 
            } else {
                this._audioSource.play(); 
            }
        }

        if (this.muteButtonNode && this.soundOnSprite && this.soundOffSprite) {
            const spriteComp = this.muteButtonNode.getComponent(Sprite);
            if (spriteComp) {
                spriteComp.spriteFrame = this._isMuted ? this.soundOffSprite : this.soundOnSprite;
            }
        }
    }

    private triggerWinState() {
        if (this._gameWon) return;
        this._gameWon = true;
        this._isTimerRunning = false; // Stop auto-redirect timer
        this.scheduleOnce(() => { this.showCTA(); }, 0.5);
    }

    private getTopCard(holder: Node): Node | null {
        if (!holder) return null;
        const cards = holder.children.filter(c => c.active && c.name.startsWith("card"));
        return cards.length > 0 ? cards[cards.length - 1] : null;
    }

    private updateMovesLabel() {
        if (this.movesLabel) this.movesLabel.string = `${ this._currentMoves}`;
    }

    private triggerLoseState() {
        if (this._gameWon || this._gameOver) return;
        this._gameOver = true;
        this._isTimerRunning = false; // Stop auto-redirect timer
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
            .call(() => {
                this.playYouLostPulse();
            })
            .start();
    }
    
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
        if (this._isMuted) return;
        if (this._audioSource && !this._audioSource.playing) this._audioSource.play(); 
    }
   
    private setupInitialState() {
        if (this.mainNode) this.mainNode.active = false;
        if (this.introNode) this.introNode.active = false; 
        if (this.ctaScreen) this.ctaScreen.active = false;
        if (this.youLostScreen) this.youLostScreen.active = false;
        if (this.timePopupNode) this.timePopupNode.active = false;
        
        if (this.hintHandNode) this.hintHandNode.active = false; 
        
        this._currentMoves = this.maxMoves;
        this.updateMovesLabel();
        if (this.stackOutline) this.stackOutline.clear();
    }
   
    private startSequence() {
        this.startGameLogic();
        
        // Start the continuous loop timer
        this._redirectTimer = 0;
        this._isTimerRunning = true;
    }

    private playIntroSequence() {
        if (this.introNode) {
            this.introNode.active = true;
            this._animationComplete = true; 
            
            const opacityComp = this.introNode.getComponent(UIOpacity) || this.introNode.addComponent(UIOpacity);
            opacityComp.opacity = 255;
            
            this.scheduleOnce(() => {
                tween(opacityComp)
                    .to(0.5, { opacity: 0 })
                    .call(() => { 
                        this.introNode.active = false; 
                    })
                    .start();
            }, 3.0);
        } else {
            this._animationComplete = true;
        }
    }

    // =========================================================================
    // ✨ CONFETTI & CTA LOGIC
    // =========================================================================

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
            .call(() => {
                this.playCTAPulse();
            })
            .start();
    }
   
    private playCTAPulse() {
        if (!isValid(this.ctaScreen)) return;
        
        tween(this.ctaScreen).repeatForever(
            tween()
                .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
        ).start();

        this.playEpicConfetti();
        
        this.schedule(() => {
            if (this.ctaScreen.active) {
                this.playEpicConfetti();
            }
        }, 1.6);
    }

    private playYouLostPulse() {
        if (!isValid(this.youLostScreen)) return;
        
        tween(this.youLostScreen).repeatForever(
            tween()
                .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
        ).start();
    }

    private playEpicConfetti() {
        const elegantColors = [
            new Color(255, 215, 0, 255),   // Magical Gold
            new Color(100, 255, 150, 255), // Forest Glow Green
            new Color(255, 255, 255, 255)  // Pure White
        ];

        this.createMysticBurst(0, -150, 80, elegantColors);

        this.scheduleOnce(() => {
            this.createEnchantedCascade(elegantColors, 40);
        }, 0.3); 
        
        this.scheduleOnce(() => {
            this.createEnchantedCascade(elegantColors, 35);
        }, 1.2);
        
        this.scheduleOnce(() => {
            this.createEnchantedCascade(elegantColors, 35);
        }, 2.4);
    }

    private createMysticBurst(startX: number, startY: number, count: number, colors: Color[]) {
        if (!this.confettiPrefab || !this.confettiContainer) return;

        for (let i = 0; i < count; i++) {
            const piece = instantiate(this.confettiPrefab);
            this.confettiContainer.addChild(piece);

            const sprite = piece.getComponent(Sprite);
            const uiOpacity = piece.getComponent(UIOpacity) || piece.addComponent(UIOpacity);
            uiOpacity.opacity = 255;

            if (sprite) sprite.color = colors[Math.floor(Math.random() * colors.length)];
            
            const baseScale = Math.random() * 0.3 + 0.08;
            piece.setScale(new Vec3(baseScale, baseScale, 1));
            piece.setPosition(startX, startY, 0);

            const angle = Math.random() * Math.PI * 2; 
            const force = Math.random() * 700 + 300; 
            
            const burstTargetX = startX + (Math.cos(angle) * force);
            const burstTargetY = startY + (Math.sin(angle) * force);

            const burstDuration = Math.random() * 0.4 + 0.2; 
            const floatDuration = Math.random() * 1.5 + 1.0; 

            const animState = { t: 0 };
            
            tween(animState)
                .to(burstDuration, { t: 1 }, {
                    easing: 'expoOut', 
                    onUpdate: (target: {t: number}) => {
                        const progress = target.t;
                        const currentX = math.lerp(startX, burstTargetX, progress);
                        const currentY = math.lerp(startY, burstTargetY, progress);
                        
                        piece.setPosition(currentX, currentY, 0);
                        piece.angle = progress * 720; 
                    }
                })
                .call(() => { animState.t = 0; })
                .to(floatDuration, { t: 1 }, {
                    easing: 'sineOut',
                    onUpdate: (target: {t: number}) => {
                        const progress = target.t;
                        
                        const currentY = math.lerp(burstTargetY, burstTargetY - 80, progress);
                        piece.setPosition(burstTargetX, currentY, 0);
                        
                        uiOpacity.opacity = math.lerp(255, 0, progress);
                        piece.angle += 2;
                    }
                })
                .call(() => { piece.destroy(); })
                .start();
        }
    }

    private createEnchantedCascade(colors: Color[], count: number) {
        if (!this.confettiPrefab || !this.confettiContainer) return;

        const screenSize = view.getVisibleSize();
        
        for (let i = 0; i < count; i++) {
            const piece = instantiate(this.confettiPrefab);
            this.confettiContainer.addChild(piece);

            const sprite = piece.getComponent(Sprite);
            const uiOpacity = piece.getComponent(UIOpacity) || piece.addComponent(UIOpacity);
            
            if (sprite) sprite.color = colors[Math.floor(Math.random() * colors.length)];
            
            const startX = (Math.random() * screenSize.width) - (screenSize.width / 2);
            const startY = (screenSize.height / 2) + 100 + (Math.random() * 300); 
            piece.setPosition(startX, startY, 0);

            const isForeground = Math.random() > 0.85; 
            const baseScale = isForeground ? (Math.random() * 0.5 + 0.4) : (Math.random() * 0.2 + 0.05);
            piece.setScale(new Vec3(baseScale, baseScale, 1));
            
            const maxOpacity = isForeground ? 255 : 160;

            const fallSpeed = Math.random() * 4.0 + 2.5; 
            const swayWidth = Math.random() * 200 + 50;  
            const swaySpeed = Math.random() * 1.5 + 0.5;     
            const turbulence = Math.random() * 4 + 2; 
            
            const tumbleSpeed = Math.random() * 4 + 1; 
            const spinDirection = Math.random() > 0.5 ? 1 : -1;
            const spinSpeed = (Math.random() * 3 + 0.5) * spinDirection; 

            const animState = { t: 0 };
            
            tween(animState)
                .to(fallSpeed, { t: 1 }, {
                    onUpdate: (target: {t: number}) => {
                        const progress = target.t;
                        
                        const currentY = math.lerp(startY, -screenSize.height / 2 - 150, progress);
                        
                        const primarySway = Math.sin(progress * Math.PI * swaySpeed) * swayWidth;
                        const erraticFlutter = Math.cos(progress * Math.PI * turbulence) * (swayWidth * 0.25);
                        
                        piece.setPosition(startX + primarySway + erraticFlutter, currentY, 0);

                        const scaleFlip = Math.cos(progress * Math.PI * tumbleSpeed);
                        piece.setScale(new Vec3(scaleFlip * baseScale, baseScale, 1));
                        
                        piece.angle += spinSpeed;

                        if (progress < 0.1) {
                            uiOpacity.opacity = math.lerp(0, maxOpacity, progress * 10);
                        } else if (progress > 0.8) {
                            uiOpacity.opacity = math.lerp(maxOpacity, 0, (progress - 0.8) / 0.2);
                        } else {
                            uiOpacity.opacity = maxOpacity;
                        }
                    }
                })
                .call(() => { piece.destroy(); })
                .start();
        }
    }
}