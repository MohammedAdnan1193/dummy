import { _decorator, Component, Node, Vec3, UITransform, tween, isValid, Tween, SpriteFrame, Sprite, UIOpacity, EventTouch, Layout, AudioSource, AudioClip, Enum, Vec2, math, Color } from 'cc';
import { CardFlipper } from './flip'; 
import { GameManager } from './GameManager'; 

const { ccclass, property } = _decorator;

export interface CardData {
    value: number;
    suit: number;
    isRed: boolean;
    node: Node;
}

export enum HolderType {
    TABLEAU = 1,
    FOUNDATION = 2,
    STOCK = 3,
    WASTE = 4
}

@ccclass('CardLogic')
export class CardLogic extends Component {

    @property({ type: Enum(HolderType) })
    public holderType: HolderType = HolderType.TABLEAU;

    @property(Node)
    public placeholderNode: Node = null!;

    @property(Node)
    public visualDeckTop: Node = null!;

    @property(Node)
    public emptyStockVisual: Node = null!;

    @property(SpriteFrame)
    public wrongClickSprite: SpriteFrame = null!;

    @property(SpriteFrame)
    public ringSprite: SpriteFrame = null!;

    @property(SpriteFrame)
    public starSprite: SpriteFrame = null!;

    @property(AudioClip)
    public successSound: AudioClip = null!;

    @property(AudioClip)
    public errorSound: AudioClip = null!;

    @property(GameManager)
    public gameManager: GameManager = null!;

    private _audioSource: AudioSource = null!;

    // --- ANIMATION STATE ---
    private _isAnimating: boolean = false; 

    // --- DRAG AND DROP STATE ---
    private _isDragging: boolean = false;
    private _dragThresholdPassed: boolean = false;
    private _dragStartPos: Vec2 = new Vec2();
    private _dragOffset: Vec3 = new Vec3();
    private _draggedCards: Node[] = [];
    
    // --- PHYSICS & UX STATE ---
    private _currentVelocityX: number = 0;
    private _activeHighlightTarget: CardLogic | null = null; // Tracks which pile is currently glowing
    
    // To return cards if drop fails
    private _originalParent: Node = null!;
    private _originalPositions: Vec3[] = [];
    private _originalSiblingIndices: number[] = [];

    public getAnimationLock(): boolean {
        return this._isAnimating;
    }

    public setAnimationLock(isLocked: boolean) {
        this._isAnimating = isLocked;
    }

    onLoad() {
        this._audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.updatePlaceholderVisibility();
    }
    
    update(dt: number) {
        if (this._isDragging && this.gameManager) {
            this.gameManager.resetIdleTimer();
        }
    }

    // =========================================================================
    // ✋ TOUCH & DRAG LOGIC (UX ENHANCED)
    // =========================================================================

    onTouchStart(event: EventTouch) {
        if (this.gameManager) {
            if (!this.gameManager.isAnimationComplete) return;
            this.gameManager.resetIdleTimer();
        }
        if (this._isAnimating) return;

        if (this.holderType === HolderType.STOCK || this.holderType === HolderType.FOUNDATION) {
            this.handleStandardClick(event); 
            return;
        }

        const touchUILoc = event.getUILocation();
        const clickedCard = this.getCardUnderTouch(touchUILoc);
        
        if (!clickedCard || clickedCard.name.includes("faceDown")) {
            this.handleStandardClick(event);
            return;
        }

        const allChildren = this.node.children;
        const index = allChildren.indexOf(clickedCard);
        this._draggedCards = allChildren.slice(index).filter(c => c.active && c !== this.placeholderNode);

        if (this._draggedCards.length === 0) return;

        this._isDragging = true;
        this._dragThresholdPassed = false;
        this._dragStartPos.set(touchUILoc.x, touchUILoc.y);
        this._currentVelocityX = 0;

        const cardWorldPos = clickedCard.getWorldPosition();
        this._dragOffset.set(cardWorldPos.x - touchUILoc.x, cardWorldPos.y - touchUILoc.y, 0);

        this.node.on(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
    }

    onDragMove(event: EventTouch) {
        if (!this._isDragging) return;

        const uiLoc = event.getUILocation();

        if (!this._dragThresholdPassed) {
            const dist = Vec2.distance(this._dragStartPos, uiLoc);
            if (dist > 10) { 
                this._dragThresholdPassed = true;
                this.startDraggingVisuals(); 
            } else {
                return; 
            }
        }

        if (this._draggedCards.length > 0 && this.gameManager.globalOverlay) {
            const overlayTransform = this.gameManager.globalOverlay.getComponent(UITransform);
            const fingerOffset = new Vec3(0, 80, 0); 
            const worldPos = new Vec3(uiLoc.x, uiLoc.y, 0).add(this._dragOffset).add(fingerOffset);
            const localPos = overlayTransform.convertToNodeSpaceAR(worldPos);

            const diffX = localPos.x - this._draggedCards[0].position.x;
            this._currentVelocityX = math.lerp(this._currentVelocityX, diffX, 0.5); 
            const targetAngle = math.clamp(-this._currentVelocityX * 1.5, -15, 15);

            this._draggedCards[0].setPosition(localPos);
            const currentAngle = this._draggedCards[0].angle;
            this._draggedCards[0].angle = math.lerp(currentAngle, targetAngle, 0.2);

            for (let i = 1; i < this._draggedCards.length; i++) {
                const currentCard = this._draggedCards[i];
                const prevCard = this._draggedCards[i-1];
                
                const targetPos = prevCard.position.clone();
                targetPos.y -= 45; 

                const smoothX = math.lerp(currentCard.position.x, targetPos.x, 0.45); 
                const smoothY = math.lerp(currentCard.position.y, targetPos.y, 0.45);

                currentCard.setPosition(smoothX, smoothY, 0);
                currentCard.angle = math.lerp(currentCard.angle, prevCard.angle * 0.9, 0.2);
            }

            this.checkAndHighlightTarget();
        }
    }

    onDragEnd(event: EventTouch) {
        if (this.gameManager) this.gameManager.resetIdleTimer();
        
        this.node.off(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
        this._isDragging = false;
        
        if (this._activeHighlightTarget) {
            this._activeHighlightTarget.setHighlightState(false);
            this._activeHighlightTarget = null;
        }

        if (!this._dragThresholdPassed) {
            this._draggedCards = []; 
            this.handleStandardClick(event);
            return;
        }
        
        this._draggedCards.forEach(c => {
             tween(c).to(0.1, { angle: 0 }).start();
        });

        this.attemptDrop();
    }

    checkAndHighlightTarget() {
        const headCard = this._draggedCards[0];
        const headWorldPos = headCard.getWorldPosition();

        const targets = [...this.gameManager.tableauNodes, ...this.gameManager.foundationNodes];
        let foundTarget: CardLogic | null = null;
        let minDist = 200; 

        for (const targetNode of targets) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic || targetLogic === this) continue;
            
            let targetHotspot = targetNode.getWorldPosition();
            const targetChildren = targetLogic.node.children.filter(c => c.active && c.name.startsWith("card"));
            if (targetChildren.length > 0) {
                targetHotspot = targetChildren[targetChildren.length - 1].getWorldPosition();
            }

            const dist = Vec3.distance(headWorldPos, targetHotspot);

            if (dist < minDist) {
                // Calling with isVerbose = false to prevent console spam during hover
                if (this.checkSpecificDropValidity(headCard, targetLogic, false)) {
                    minDist = dist;
                    foundTarget = targetLogic;
                }
            }
        }

        if (foundTarget !== this._activeHighlightTarget) {
            if (this._activeHighlightTarget) this._activeHighlightTarget.setHighlightState(false);
            if (foundTarget) foundTarget.setHighlightState(true);
            this._activeHighlightTarget = foundTarget;
        }
    }

    public setHighlightState(isActive: boolean) {
        let targetVisual: Node | null = null;
        const activeCards = this.node.children.filter(c => 
            c.active && 
            c !== this.placeholderNode && 
            (c.name.startsWith("card") || c.name.includes("faceDown"))
        );

        if (activeCards.length > 0) {
            targetVisual = activeCards[activeCards.length - 1];
        } else {
            if (this.placeholderNode && isValid(this.placeholderNode)) {
                targetVisual = this.placeholderNode;
            }
        }

        if (!targetVisual) return;
        Tween.stopAllByTarget(targetVisual);

        if (isActive) {
            tween(targetVisual).to(0.15, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'sineOut' }).start();
        } else {
            tween(targetVisual).to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' }).start();
        }
    }

    startDraggingVisuals() {
        const overlay = this.gameManager.globalOverlay;
        if (!overlay) return;

        const overlayTrans = overlay.getComponent(UITransform);
        this._originalParent = this.node;
        
        this._originalPositions = this._draggedCards.map(c => c.getPosition().clone());
        this._originalSiblingIndices = this._draggedCards.map(c => c.getSiblingIndex());

        this._draggedCards.forEach((card, index) => {
            const startWorldScale = card.getWorldScale().clone();   
            const worldPos = card.getWorldPosition();
            const localOverlayPos = overlayTrans.convertToNodeSpaceAR(worldPos);

            card.setParent(overlay);
            card.setPosition(localOverlayPos);
            card.setWorldScale(startWorldScale); 
            
            const currentScale = card.getScale();
            tween(card)
                .to(0.1, { scale: new Vec3(currentScale.x * 1.2, currentScale.y * 1.2, 1) }, { easing: 'backOut' })
                .start();
            
            const op = card.getComponent(UIOpacity) || card.addComponent(UIOpacity);
            op.opacity = 255;
        });
    }

    attemptDrop() {
        const headCard = this._draggedCards[0];
        const headWorldPos = headCard.getWorldPosition();
        
        console.log(`%c[Attempt Drop] Dropping ${headCard.name} at WorldPos: (${headWorldPos.x.toFixed(2)}, ${headWorldPos.y.toFixed(2)})`, "color: #00BCD4; font-weight: bold;");

        const targets = [...this.gameManager.tableauNodes, ...this.gameManager.foundationNodes];
        let bestTarget: CardLogic | null = null;
        let closestDist = 1000;

        for (const targetNode of targets) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic || targetLogic === this) continue;

            let targetDropPoint = targetNode.getWorldPosition();
            const children = targetLogic.node.children.filter(c => c.active && c.name.startsWith("card"));
            if (children.length > 0) {
                targetDropPoint = children[children.length - 1].getWorldPosition();
            }

            const dist = Vec3.distance(headWorldPos, targetDropPoint);

            if (dist < 150) { 
                console.log(`%c  -> Nearby Target Found: ${targetNode.name} (Distance: ${dist.toFixed(2)})`, "color: #FFC107");
                if (dist < closestDist) {
                    // Call with isVerbose = true to log WHY it succeeds or fails
                    if (this.checkSpecificDropValidity(headCard, targetLogic, true)) {
                        closestDist = dist;
                        bestTarget = targetLogic;
                    }
                }
            }
        }

        if (bestTarget) {
            console.log(`%c[Attempt Drop] 🎯 SUCCESS: Executing drop on ${bestTarget.node.name}`, "color: #4CAF50; font-weight: bold;");
            this._draggedCards.forEach(c => {
                const op = c.getComponent(UIOpacity) || c.addComponent(UIOpacity);
                op.opacity = 255;
            });
            this.executeStackMove(this._draggedCards, bestTarget);
            this._draggedCards = []; 
        } else {
            console.log(`%c[Attempt Drop] ❌ FAILED: No valid targets in range. Returning to original position.`, "color: #F44336; font-weight: bold;");
            this.returnCardsToOriginal();
        }
    }

    checkSpecificDropValidity(dragHead: Node, targetLogic: CardLogic, isVerbose: boolean = false): boolean {
        if (targetLogic.getAnimationLock()) {
            if (isVerbose) console.log(`    ❌ Rejecting ${targetLogic.node.name}: Target is currently animating/locked.`);
            return false;
        }
        
        const dragData = this.getCardData(dragHead);
        if (!dragData) {
            if (isVerbose) console.log(`    ❌ Rejecting ${targetLogic.node.name}: Dragged item is not a valid card data.`);
            return false;
        }

        const targetChildren = targetLogic.node.children.filter(c => 
            c.active && c !== targetLogic.placeholderNode && c.name.startsWith("card")
        );

        const isTargetEmpty = targetChildren.length === 0;

        if (isTargetEmpty) {
            if (targetLogic.holderType === HolderType.TABLEAU) {
                const isValid = dragData.value === 12; // King only
                if (isVerbose && !isValid) console.log(`    ❌ Rejecting ${targetLogic.node.name}: Empty Tableau requires a King (value 12). Got: ${dragData.value}.`);
                if (isVerbose && isValid) console.log(`    ✅ Accepting ${targetLogic.node.name}: Dragged is King to empty Tableau.`);
                return isValid;
            } else if (targetLogic.holderType === HolderType.FOUNDATION) {
                const isValid = dragData.value === 0 && this._draggedCards.length === 1;
                if (isVerbose && !isValid) console.log(`    ❌ Rejecting ${targetLogic.node.name}: Empty Foundation requires single Ace (value 0). Dragged length: ${this._draggedCards.length}, value: ${dragData.value}.`);
                if (isVerbose && isValid) console.log(`    ✅ Accepting ${targetLogic.node.name}: Dragged is single Ace to empty Foundation.`);
                return isValid;
            }
        } 
        else {
            const topTarget = targetChildren[targetChildren.length - 1];
            const targetData = this.getCardData(topTarget);
            if (!targetData) return false;

            if (targetLogic.holderType === HolderType.TABLEAU) {
                const isValid = (dragData.isRed !== targetData.isRed) && (targetData.value === dragData.value + 1);
                if (isVerbose && !isValid) console.log(`    ❌ Rejecting ${targetLogic.node.name} (Tableau): Needs alternating color & n-1. Target [Red:${targetData.isRed}, Val:${targetData.value}] vs Dragged [Red:${dragData.isRed}, Val:${dragData.value}].`);
                if (isVerbose && isValid) console.log(`    ✅ Accepting ${targetLogic.node.name} (Tableau): Valid alternating sequence.`);
                return isValid;
            } else if (targetLogic.holderType === HolderType.FOUNDATION) {
                const isValid = (dragData.suit === targetData.suit) && (dragData.value === targetData.value + 1) && this._draggedCards.length === 1;
                if (isVerbose && !isValid) console.log(`    ❌ Rejecting ${targetLogic.node.name} (Foundation): Needs matching suit & n+1 & single card. Target [Suit:${targetData.suit}, Val:${targetData.value}] vs Dragged [Suit:${dragData.suit}, Val:${dragData.value}].`);
                if (isVerbose && isValid) console.log(`    ✅ Accepting ${targetLogic.node.name} (Foundation): Valid ascending suit sequence.`);
                return isValid;
            }
        }
        return false;
    }

    returnCardsToOriginal() {
        this._isAnimating = true; 

        const overlayTrans = this.gameManager.globalOverlay.getComponent(UITransform);
        const parentTrans = this._originalParent.getComponent(UITransform);

        let completedCount = 0;
        const totalCards = this._draggedCards.length;

        this._draggedCards.forEach((card, index) => {
            const originalPos = this._originalPositions[index];
            const worldDest = parentTrans.convertToWorldSpaceAR(originalPos);
            const overlayDest = overlayTrans.convertToNodeSpaceAR(worldDest);

            tween(card)
                .parallel(
                    tween().to(0.3, { position: overlayDest }, { easing: 'sineOut' }), 
                    tween().to(0.3, { angle: 0 }, { easing: 'sineOut' }),            
                    tween().to(0.2, { scale: new Vec3(1, 1, 1) })                      
                )
                .call(() => {
                    completedCount++;
                    if (completedCount === totalCards) {
                        this.finalizeReturn();
                    }
                })
                .start();
        });
    }

    finalizeReturn() {
        this._draggedCards.forEach((card, index) => {
            card.setParent(this._originalParent);
            card.setPosition(this._originalPositions[index]);
            card.setSiblingIndex(this._originalSiblingIndices[index]);
            
            const op = card.getComponent(UIOpacity) || card.addComponent(UIOpacity);
            op.opacity = 255;
        });

        this._draggedCards = [];
        this._isAnimating = false; 
    }

    getCardUnderTouch(uiLoc: Vec2): Node | null {
        for (let i = this.node.children.length - 1; i >= 0; i--) {
            const child = this.node.children[i];
            if (!child.active || child === this.placeholderNode) continue;

            const trans = child.getComponent(UITransform);
            if (trans && trans.isHit(uiLoc)) {
                return child;
            }
        }
        return null;
    }

    // =========================================================================
    // 🧠 CLICK & MOVE LOGIC (Standard)
    // =========================================================================

    handleStandardClick(event: EventTouch) {
        const touchUILoc = event.getUILocation();
        console.log(`\n%c[Click Event] Registered click on stack: ${this.node.name} at UILoc: (${touchUILoc.x.toFixed(2)}, ${touchUILoc.y.toFixed(2)})`, "color: #E91E63; font-weight: bold;");

        if (this.holderType === HolderType.FOUNDATION) {
            console.log(`%c  -> Invalid Click: Cannot auto-move cards out of Foundation stacks.`, "color: #F44336");
            this.playSFX(this.errorSound);
            this.showWrongFeedback(event, null);
            return;
        }

        if (this._isAnimating) {
            console.log(`%c  -> Invalid Click: Stack ${this.node.name} is currently locked/animating.`, "color: #F44336");
            return;
        }

        if (this.holderType === HolderType.STOCK) {
            console.log(`%c  -> Routing click to Stock Drawer logic.`, "color: #9C27B0");
            this.handleStockClick();
            return;
        }

        const activeFlippers = this.node.getComponentsInChildren(CardFlipper);
        if (activeFlippers.some(flipper => flipper.isFlipping)) {
            console.log(`%c  -> Invalid Click: A card in this stack is currently flipping.`, "color: #F44336");
            return; 
        }

        const faceUpCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            c !== this.visualDeckTop &&
            c !== this.emptyStockVisual &&
            c.active &&
            c.name.startsWith("card") 
        );

        if (faceUpCards.length > 0) {
            const topCard = faceUpCards[faceUpCards.length - 1];
            const topData = this.getCardData(topCard);

            console.log(`%c  -> Clicked card identified as: ${topCard.name}. Checking for valid auto-moves...`, "color: #2196F3");

            // Check Foundation first
            if (topData && this.findFoundationMove(topData, [topCard], true)) {
                return; 
            }

            // Then check Tableau
            if (this.holderType === HolderType.WASTE) {
                if (topData && this.findValidMove(topData, [topCard], true)) {
                    return; 
                }
            } else {
                for (let i = 0; i < faceUpCards.length; i++) {
                    const headCard = faceUpCards[i];
                    const headData = this.getCardData(headCard);
                    const subStack = faceUpCards.slice(i); 
                    
                    if (headData && this.findValidMove(headData, subStack, true)) {
                        return;
                    }
                }
            }
        } else {
             console.log(`%c  -> Invalid Click: Stack ${this.node.name} has no face-up cards to move.`, "color: #F44336");
        }

        console.log(`%c  -> ❌ FAILED: No valid auto-move destinations found for this click.`, "color: #F44336; font-weight: bold;");
        this.playSFX(this.errorSound);
        this.showWrongFeedback(event, this.getCardUnderTouch(event.getUILocation()));
    }

    private handleStockClick() {
        if (!this.gameManager || !this.gameManager.wasteNode) return;
        if (this._isAnimating) return;

        if (this.emptyStockVisual && this.emptyStockVisual.active) return;

        const wasteNode = this.gameManager.wasteNode;
        const wasteLogic = wasteNode.getComponent(CardLogic);
        const stockCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            c !== this.visualDeckTop && 
            c !== this.emptyStockVisual &&
            c.name.startsWith("card")
        );

        if (stockCards.length > 0) {
            const topCard = stockCards[stockCards.length - 1];
            this._isAnimating = true;
            topCard.setSiblingIndex(this.node.children.length - 1); 

            console.log(`%c[Stock Click] Drawing card ${topCard.name} to Waste.`, "color: #4CAF50; font-weight: bold;");

            if (wasteLogic) {
                this.executeStackMove([topCard], wasteLogic, () => {
                    this._isAnimating = false; 
                });
            } else {
                this._isAnimating = false;
            }

            if (stockCards.length - 1 === 0 && this.visualDeckTop) {
                this.visualDeckTop.active = false;
            }

        } else {
            const wasteCards = wasteNode.children.filter(c => 
                c.name.startsWith("card") && c !== wasteLogic?.placeholderNode
            );

            if (wasteCards.length === 0) {
                if (this.emptyStockVisual) this.emptyStockVisual.active = true;
                if (this.placeholderNode) this.placeholderNode.active = false;
                if (this.visualDeckTop) this.visualDeckTop.active = false;
                console.log(`%c[Stock Click] ❌ Invalid: Stock and Waste are both completely empty.`, "color: #F44336");
                this.playSFX(this.errorSound);
                return;
            }

            console.log(`%c[Stock Click] Stock empty! Recycling ${wasteCards.length} cards from Waste back to Stock.`, "color: #FFC107; font-weight: bold;");
            this.playSFX(this.successSound); 
            this._isAnimating = true;

            const reversedWaste = wasteCards.reverse();
            const overlay = this.gameManager.globalOverlay;
            const overlayTransform = overlay.getComponent(UITransform);
            const stockWorldPos = this.node.getWorldPosition();
            
            let targetPosInOverlay = new Vec3();
            if (overlayTransform) {
                targetPosInOverlay = overlayTransform.convertToNodeSpaceAR(stockWorldPos);
            } else {
                targetPosInOverlay = stockWorldPos;
            }

            let completedCount = 0;
            const totalCards = reversedWaste.length;

            reversedWaste.forEach((card, index) => {
                const startWorldPos = card.getWorldPosition().clone();
                const startWorldScale = card.getWorldScale().clone(); 

                card.setParent(overlay);
                card.setWorldScale(startWorldScale); 
                const baseScale = card.scale.clone(); 
                
                let startLocalPos = overlayTransform ? overlayTransform.convertToNodeSpaceAR(startWorldPos) : startWorldPos;
                card.setPosition(startLocalPos);
                card.setSiblingIndex(999 + index);

                const flightDuration = 0.45;
                const staggerDelay = index * 0.035; 

                tween(card)
                    .delay(staggerDelay)
                    .parallel(
                        tween().to(flightDuration, { position: targetPosInOverlay }, { easing: 'cubicInOut' }),
                        tween()
                            .to(flightDuration * 0.5, { scale: new Vec3(0, baseScale.y, baseScale.z) }) 
                            .call(() => {
                                const flipper = card.getComponent(CardFlipper);
                                if (flipper) flipper.setFaceDown(); 
                            })
                            .to(flightDuration * 0.5, { scale: baseScale }) 
                    )
                    .call(() => {
                        card.setParent(this.node);
                        card.setPosition(0, 0, 0); 
                        card.setScale(1, 1, 1); 
                        completedCount++;

                        if (completedCount === totalCards) {
                            if (this.visualDeckTop) {
                                this.visualDeckTop.active = true;
                                this.visualDeckTop.setSiblingIndex(this.node.children.length - 1);
                            }
                            this.updatePlaceholderVisibility();
                            this._isAnimating = false; 
                        }
                    })
                    .start();
            });

            if (wasteLogic) wasteLogic.updatePlaceholderVisibility();
        }
    }

    executeStackMove(nodesToMove: Node[], target: CardLogic, onComplete?: () => void) {
        if (!this.gameManager || !this.gameManager.globalOverlay) {
            if (onComplete) onComplete(); 
            return;
        }

        this.setAnimationLock(true);
        target.setAnimationLock(true);

        const overlay = this.gameManager.globalOverlay;
        const overlayTransform = overlay.getComponent(UITransform);
        const targetLayout = target.getComponent(Layout);

        if (this.gameManager) this.gameManager.addValidMove(this.node); 

        // =========================================================
        // 1. STOCK DRAW LOGIC
        // =========================================================
        if (this.holderType === HolderType.STOCK) {
            let completedCount = 0;
            const totalCount = nodesToMove.length;
            nodesToMove.forEach(cardNode => {
                const startWorldPos = cardNode.getWorldPosition().clone();
                const startWorldScale = cardNode.getWorldScale().clone(); 
                const targetWorldPos = target.node.getWorldPosition().clone();

                cardNode.setParent(overlay);
                cardNode.setWorldScale(startWorldScale); 
                const baseScale = cardNode.scale.clone(); 
                
                let startLocalPos = overlayTransform ? overlayTransform.convertToNodeSpaceAR(startWorldPos) : startWorldPos;
                let targetLocalPos = overlayTransform ? overlayTransform.convertToNodeSpaceAR(targetWorldPos) : targetWorldPos;

                cardNode.setPosition(startLocalPos);
                
                const midX = (startLocalPos.x + targetLocalPos.x) / 2;
                const midY = (startLocalPos.y + targetLocalPos.y) / 2 + 60; 
                const peakPos = new Vec3(midX, midY, 0);
                const messyPileAngle = (Math.random() * 4) - 2; 

                cardNode.setSiblingIndex(999); 
                const duration = 0.35; 

                tween(cardNode)
                    .parallel(
                        tween()
                            .to(duration * 0.5, { position: peakPos }, { easing: 'sineOut' }) 
                            .to(duration * 0.5, { position: targetLocalPos }, { easing: 'sineIn' }),

                        tween()
                            .to(duration * 0.5, { scale: new Vec3(0, baseScale.y * 1.15, baseScale.z) }, { easing: 'sineIn' }) 
                            .call(() => {
                                const flipper = cardNode.getComponent(CardFlipper);
                                const sprite = cardNode.getComponent(Sprite);
                                if (flipper && sprite && flipper.faceUpSprite) {
                                    sprite.spriteFrame = flipper.faceUpSprite;
                                    cardNode.name = flipper.faceUpSprite.name;
                                }
                            })
                            .to(duration * 0.5, { scale: baseScale }, { easing: 'sineOut' }),
                        tween().to(duration, { angle: messyPileAngle })
                    )
                    .call(() => {
                        if (target.node && isValid(target.node)) {
                            cardNode.setParent(target.node);
                            cardNode.setPosition(0, 0, 0); 
                            cardNode.setScale(1, 1, 1); 
                            cardNode.angle = messyPileAngle; 
                            
                            tween(cardNode).to(0.1, { scale: new Vec3(1.05, 0.95, 1) }).to(0.15, { scale: new Vec3(1, 1, 1) }).start();
                            this.updatePlaceholderVisibility();
                            target.updatePlaceholderVisibility();

                        }
                        completedCount++;
                        if (completedCount === totalCount) {
                            this.playSuccessEffect(nodesToMove[nodesToMove.length - 1]); 
                            this.setAnimationLock(false);
                            target.setAnimationLock(false);
                            if (onComplete) onComplete(); 
                        }
                    })
                    .start();
            });
            return; 
        }

        // =========================================================
        // 2. STANDARD MOVE LOGIC
        // =========================================================
        const startWorldPositions = nodesToMove.map(node => node.getWorldPosition().clone());
        const startWorldScales = nodesToMove.map(node => node.getWorldScale().clone());
        
        nodesToMove.forEach(cardNode => {
            const op = cardNode.getComponent(UIOpacity) || cardNode.addComponent(UIOpacity);
            op.opacity = 0; 
            cardNode.setParent(target.node); 
        });

        target.updatePlaceholderVisibility(); 
        if (targetLayout) targetLayout.updateLayout(); 
        this.updatePlaceholderVisibility(); 

        target.node.updateWorldTransform(); 
        nodesToMove.forEach(node => node.updateWorldTransform()); 

        const finalWorldPositions = nodesToMove.map(node => node.getWorldPosition().clone());
        const finalLocalPositions = nodesToMove.map(node => node.getPosition().clone());

        nodesToMove.forEach((cardNode, index) => {
            cardNode.setParent(overlay);
            cardNode.setWorldPosition(startWorldPositions[index]);
            cardNode.setWorldScale(startWorldScales[index]);
            const op = cardNode.getComponent(UIOpacity) || cardNode.addComponent(UIOpacity);
            op.opacity = 255;
        });

        let completedCount = 0;
        const totalCards = nodesToMove.length;

        if (targetLayout) {
            targetLayout.enabled = false; 
        }

        nodesToMove.forEach((cardNode, index) => {
            let targetPosInOverlay = overlayTransform ? overlayTransform.convertToNodeSpaceAR(finalWorldPositions[index]) : finalWorldPositions[index];
            const startPos = cardNode.position.clone();
            const originalScale = cardNode.scale.clone();

            const midX = (startPos.x + targetPosInOverlay.x) / 2;
            const midY = (startPos.y + targetPosInOverlay.y) / 2 + 150; 
            const midPos = new Vec3(midX, midY, 0);

            const randomTilt = (Math.random() * 20) - 10;
            const flightDuration = 0.45; 
            const staggerDelay = index * 0.05; 

            cardNode.setSiblingIndex(999); 

            tween(cardNode)
                .delay(staggerDelay)
                .parallel(
                    tween()
                        .to(flightDuration * 0.5, { position: midPos }, { easing: 'sineOut' })
                        .to(flightDuration * 0.5, { position: targetPosInOverlay }, { easing: 'quadIn' }),
                    tween()
                        .to(flightDuration * 0.5, { scale: new Vec3(originalScale.x * 1.2, originalScale.y * 1.2, 1) }, { easing: 'sineOut' })
                        .to(flightDuration * 0.5, { scale: originalScale }, { easing: 'sineIn' }),
                    tween().to(flightDuration * 0.8, { angle: randomTilt }).to(flightDuration * 0.2, { angle: 0 }) 
                )
                .call(() => {
                    if (target.node && isValid(target.node)) {
                        cardNode.setParent(target.node);
                        cardNode.setPosition(finalLocalPositions[index]);
                        cardNode.setScale(new Vec3(1, 1, 1)); 

                        tween(cardNode)
                            .to(0.1, { scale: new Vec3(1.05, 0.95, 1) })
                            .to(0.15, { scale: new Vec3(1, 1, 1) })
                            .start();

                        completedCount++;

                        if (completedCount === totalCards) {
                            nodesToMove.forEach(n => {
                                if (n.parent) n.setSiblingIndex(n.parent.children.length - 1);
                            });

                            this.playSuccessEffect(nodesToMove[nodesToMove.length - 1]); 
                            this.checkAndFlipRevealedCard(); 
                            
                            this.scheduleOnce(() => {
                                if (targetLayout && isValid(targetLayout.node)) {
                                    targetLayout.enabled = true;
                                    targetLayout.updateLayout();
                                }
                                
                                if (this.holderType === HolderType.WASTE) this.checkDeckDepletion();
                                
                                this.setAnimationLock(false);
                                target.setAnimationLock(false);

                                if (onComplete) onComplete(); 

                            }, 0.3); 
                        }
                    }
                })
                .start();
        });
    }

    findFoundationMove(movingData: CardData, sequence: Node[], isVerbose: boolean = false): boolean {
        if (sequence.length > 1) {
            if (isVerbose) console.log(`      -> Rejecting Foundation: Cannot auto-move multiple cards to foundation.`);
            return false; 
        }
        if (!this.gameManager || !this.gameManager.foundationNodes) return false;
        
        for (const targetNode of this.gameManager.foundationNodes) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic) continue;
            if (isVerbose) console.log(`    -> Checking Foundation Stack: ${targetNode.name}...`);

            if (targetLogic.getAnimationLock()) {
                if (isVerbose) console.log(`      -> Rejecting: Stack is animating/locked.`);
                continue;
            }

            const targetCards = targetLogic.node.children.filter(c => c.name.startsWith("card") && !c.name.includes("foundation_A"));
            const isTargetEmpty = targetCards.length === 0;

            if (isTargetEmpty && movingData.value === 0) {
                if (isVerbose) console.log(`      ✅ SUCCESS: Found empty foundation for Ace.`);
                this.executeStackMove(sequence, targetLogic);
                return true;
            } else if (isTargetEmpty) {
                if (isVerbose) console.log(`      -> Rejecting: Foundation is empty, but card is not an Ace (Value: ${movingData.value}).`);
            }

            if (!isTargetEmpty) {
                const topTargetCard = targetCards[targetCards.length - 1];
                const targetData = this.getCardData(topTargetCard);
                
                if (targetData && targetData.suit === movingData.suit && movingData.value === targetData.value + 1) {
                    if (isVerbose) console.log(`      ✅ SUCCESS: Found valid n+1 matching suit Foundation.`);
                    this.executeStackMove(sequence, targetLogic);
                    return true;
                } else if (targetData) {
                    if (isVerbose) console.log(`      -> Rejecting: Sequence gap or suit mismatch. Target[Suit:${targetData.suit}, Val:${targetData.value}] Dragged[Suit:${movingData.suit}, Val:${movingData.value}]`);
                }
            }
        }
        return false;
    }

    findValidMove(movingData: CardData, sequence: Node[], isVerbose: boolean = false): boolean {
        if (!this.gameManager || !this.gameManager.tableauNodes) return false;
        
        for (const targetNode of this.gameManager.tableauNodes) {
            const target = targetNode.getComponent(CardLogic);
            if (!target || target === this || target.holderType !== HolderType.TABLEAU) continue; 
            
            if (isVerbose) console.log(`    -> Checking Tableau Stack: ${targetNode.name}...`);
            if (target.getAnimationLock()) {
                if (isVerbose) console.log(`      -> Rejecting: Stack is animating/locked.`);
                continue;
            }

            const targetChildren = target.node.children.filter(c => 
                c !== target.placeholderNode && 
                (c.name.startsWith("card") || c.name.includes("faceDown"))
            );

            const isTargetEmpty = targetChildren.length === 0;

            if (isTargetEmpty) {
                if (movingData.value === 12) { 
                    if (isVerbose) console.log(`      ✅ SUCCESS: Found empty Tableau for King.`);
                    this.executeStackMove(sequence, target);
                    return true;
                } else {
                    if (isVerbose) console.log(`      -> Rejecting: Tableau is empty, but card is not a King (Value: ${movingData.value}).`);
                }
            } else {
                const bottomTarget = targetChildren[targetChildren.length - 1];
                const targetData = this.getCardData(bottomTarget); 
                
                if (targetData && (targetData.isRed !== movingData.isRed) && (targetData.value === movingData.value + 1)) {
                    if (isVerbose) console.log(`      ✅ SUCCESS: Found valid alternating color & n-1 Tableau.`);
                    this.executeStackMove(sequence, target);
                    return true;
                } else if (targetData) {
                    if (isVerbose) console.log(`      -> Rejecting: Invalid color or sequence. Target[Red:${targetData.isRed}, Val:${targetData.value}] Dragged[Red:${movingData.isRed}, Val:${movingData.value}]`);
                }
            }
        }
        return false;
    }

    getCardData(cardNode: Node): CardData | null {
        if (!cardNode.active || 
            cardNode.name === "default" || 
            cardNode.name.includes("faceDown") ||
            cardNode.name.includes("foundation_A") || 
            cardNode === this.visualDeckTop || 
            cardNode === this.emptyStockVisual || 
            cardNode.name === "WrongClickFeedback" || 
            !cardNode.name.startsWith("card")) {      
            return null;
        }
        const indexStr = cardNode.name.replace("card", "");
        const index = parseInt(indexStr);
        if (isNaN(index)) return null;

        return {
            value: index % 13,
            suit: Math.floor(index / 13),
            isRed: (Math.floor(index / 13) === 1 || Math.floor(index / 13) === 2),
            node: cardNode
        };
    }

    private checkDeckDepletion() {
        if (!this.gameManager || !this.gameManager.stockNode) return;
        const wasteCards = this.node.children.filter(c => c.name.startsWith("card") && c !== this.placeholderNode);
        if (wasteCards.length > 0) return; 

        const stockNode = this.gameManager.stockNode;
        const stockLogic = stockNode.getComponent(CardLogic);
        const stockCards = stockNode.children.filter(c => c.name.startsWith("card") || c.name.includes("faceDown"));
        const validStockCards = stockCards.filter(c => c !== stockLogic?.visualDeckTop && c !== stockLogic?.emptyStockVisual);

        if (validStockCards.length === 0) {
            if (stockLogic) {
                if (stockLogic.emptyStockVisual) stockLogic.emptyStockVisual.active = true;
                if (stockLogic.visualDeckTop) stockLogic.visualDeckTop.active = false;
                if (stockLogic.placeholderNode) stockLogic.placeholderNode.active = false;
            }
        }
    }

    private checkAndFlipRevealedCard() {
        const validCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            c !== this.visualDeckTop &&
            c !== this.emptyStockVisual &&
            (c.name.includes("faceDown") || c.name.startsWith("card"))
        );

        if (validCards.length > 0) {
            const lastCard = validCards[validCards.length - 1];
            if (lastCard.name.includes("faceDown")) {
                const flipper = lastCard.getComponent(CardFlipper);
                if (flipper) {
                    flipper.flipToFaceUp();
                    if (!lastCard.name.startsWith("card")) {
                        lastCard.name = lastCard.name.replace("faceDown_", "").replace("faceDown", "");
                    }
                }
            }
        }
    }

    private showWrongFeedback(event: EventTouch, targetNode: Node | null) {
        let targetParent = this.gameManager?.globalOverlay || this.gameManager?.node || this.node.parent || this.node;
        const touchPos = event.getUILocation();
        const worldPos = new Vec3(touchPos.x, touchPos.y, 0);
        const parentTrans = targetParent.getComponent(UITransform);
        const localPos = parentTrans ? parentTrans.convertToNodeSpaceAR(worldPos) : worldPos;

        const feedbackNode = new Node('WrongClickFeedback');
        targetParent.addChild(feedbackNode);
        feedbackNode.setPosition(localPos);
        feedbackNode.setSiblingIndex(999);

        const sprite = feedbackNode.addComponent(Sprite);
        sprite.spriteFrame = this.wrongClickSprite;
        sprite.sizeMode = Sprite.SizeMode.RAW;

        const uiOpacity = feedbackNode.addComponent(UIOpacity);
        uiOpacity.opacity = 0; 
        feedbackNode.addComponent(UITransform).setContentSize(80, 80);

        feedbackNode.angle = (Math.random() * 40) - 20;
        feedbackNode.setScale(new Vec3(0.5, 0.5, 1));

        tween(feedbackNode)
            .to(0.15, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
            .delay(0.2)
            .parallel(
                tween().by(0.4, { position: new Vec3(0, 40, 0) }, { easing: 'sineOut' }),
                tween().to(0.4, { scale: new Vec3(0.8, 0.8, 1) })
            )
            .call(() => { if (isValid(feedbackNode)) feedbackNode.destroy(); })
            .start();

        tween(uiOpacity).to(0.1, { opacity: 255 }).delay(0.25).to(0.4, { opacity: 0 }).start();

        if (targetNode && isValid(targetNode) && targetNode !== this.node) {
            const isCard = targetNode.name.startsWith("card");
            const isFaceDown = targetNode.name.includes("faceDown");

            if (isCard && !isFaceDown) {
                Tween.stopAllByTarget(targetNode);
                let baseAngle = targetNode.angle;
                if (Math.abs(baseAngle) < 15) { baseAngle = 0; targetNode.angle = 0; }

                tween(targetNode)
                    .to(0.05, { angle: baseAngle + 10 }).to(0.1, { angle: baseAngle - 10 })  
                    .to(0.1, { angle: baseAngle + 6 }).to(0.1, { angle: baseAngle - 6 })  
                    .to(0.05, { angle: baseAngle })
                    .call(() => { if (targetNode && isValid(targetNode)) targetNode.angle = baseAngle; })
                    .start();
            }
        }
    }

    private playSFX(clip: AudioClip) {
        if (clip && this._audioSource) this._audioSource.playOneShot(clip, 1.0); 
    }

    private playSuccessEffect(targetNode: Node) {
        this.playSFX(this.successSound);

        const effectContainer = new Node('EffectContainer');
        const topLayer = this.gameManager?.globalOverlay || this.node.parent;
        if (topLayer) {
            topLayer.addChild(effectContainer); 
        }
        
        effectContainer.setWorldPosition(targetNode.getWorldPosition());

        const ring = new Node('Ring');
        const ringSprite = ring.addComponent(Sprite);
        ringSprite.spriteFrame = this.ringSprite;
        const ringOpacity = ring.addComponent(UIOpacity);
        ringOpacity.opacity = 255;
        ring.addComponent(UITransform).setContentSize(200, 200); 
        effectContainer.addChild(ring);
        ring.setScale(0, 0, 1);

        const ringDuration = 0.4;
        tween(ring).to(ringDuration, { scale: new Vec3(2.0, 2.0, 1) }, { easing: 'backOut' }).start();
        tween(ringOpacity).delay(ringDuration * 0.3).to(ringDuration * 0.7, { opacity: 0 }).start();

        const particleCount = 30; 
        for (let i = 0; i < particleCount; i++) {
            const particle = new Node('Particle');
            const pSprite = particle.addComponent(Sprite);
            pSprite.spriteFrame = this.starSprite; 
            const pOpacity = particle.addComponent(UIOpacity);
            pOpacity.opacity = 255;
            particle.addComponent(UITransform).setContentSize(100, 100);
            effectContainer.addChild(particle);

            const angle = Math.random() * 360;
            const radian = angle * Math.PI / 180;
            const speed = 300 + (Math.random() - 0.5) * 150; 
            const lifetime = 0.6 + (Math.random() - 0.5) * 0.3; 
            const startScale = 0.3 + Math.random() * 0.4;
            
            particle.setScale(startScale, startScale, 1);

            const distance = speed * lifetime;
            const endX = Math.cos(radian) * distance;
            const endY = Math.sin(radian) * distance;

            tween(particle).to(lifetime, { position: new Vec3(endX, endY, 0) }, { easing: 'sineOut' }).start();
            tween(pOpacity).to(lifetime * 0.7, { opacity: 255 }).to(lifetime * 0.3, { opacity: 0 }).start();
            tween(particle).to(lifetime, { scale: new Vec3(0.05, 0.05, 1) }, { easing: 'sineIn' }).start();
        }

        tween(effectContainer.addComponent(UIOpacity))
            .delay(1.0)
            .call(() => { if (isValid(effectContainer)) effectContainer.destroy(); })
            .start();
    }

    public updatePlaceholderVisibility() {
        if (!this.placeholderNode) return;
        if (this.emptyStockVisual && this.emptyStockVisual.active) {
            this.placeholderNode.active = false;
            return;
        }

        const hasCards = this.node.children.some(c => 
            c !== this.placeholderNode && 
            c !== this.visualDeckTop &&
            c !== this.emptyStockVisual &&
            c.active && 
            (c.name.startsWith("card") || c.name.includes("faceDown"))
        );
        this.placeholderNode.active = !hasCards;
        const layout = this.getComponent(Layout);
        if (layout) layout.updateLayout();
    }
}