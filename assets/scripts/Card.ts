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
        // If the user is currently dragging a card, continuously reset the hint timer
        if (this._isDragging && this.gameManager) {
            this.gameManager.resetIdleTimer();
        }
    }

    // =========================================================================
    // ✋ TOUCH & DRAG LOGIC (UX ENHANCED)
    // =========================================================================

    onTouchStart(event: EventTouch) {
        if (this.gameManager) {
            // 🔒 NEW LOCK: Ignore all touches if the intro drop animation is still running
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

        // 1. Threshold Check
        if (!this._dragThresholdPassed) {
            const dist = Vec2.distance(this._dragStartPos, uiLoc);
            if (dist > 10) { 
                this._dragThresholdPassed = true;
                this.startDraggingVisuals(); 
            } else {
                return; 
            }
        }

        // 2. Move Logic
        if (this._draggedCards.length > 0 && this.gameManager.globalOverlay) {
            const overlayTransform = this.gameManager.globalOverlay.getComponent(UITransform);
            
            // 🌟 UX IMPROVEMENT: VISUAL LIFT (Y-OFFSET)
            // Add +80 to Y so the card appears ABOVE the user's finger (not covered by thumb)
            const fingerOffset = new Vec3(0, 80, 0); 
            
            const worldPos = new Vec3(uiLoc.x, uiLoc.y, 0).add(this._dragOffset).add(fingerOffset);
            const localPos = overlayTransform.convertToNodeSpaceAR(worldPos);

            // Physics Tilt Calculation
            const diffX = localPos.x - this._draggedCards[0].position.x;
            this._currentVelocityX = math.lerp(this._currentVelocityX, diffX, 0.5); 
            const targetAngle = math.clamp(-this._currentVelocityX * 1.5, -15, 15);

            // Apply Head Position
            this._draggedCards[0].setPosition(localPos);
            
            // Apply Tilt
            const currentAngle = this._draggedCards[0].angle;
            this._draggedCards[0].angle = math.lerp(currentAngle, targetAngle, 0.2);

            // Snake Tail Logic
            for (let i = 1; i < this._draggedCards.length; i++) {
                const currentCard = this._draggedCards[i];
                const prevCard = this._draggedCards[i-1];
                
                const targetPos = prevCard.position.clone();
                targetPos.y -= 45; 

                const smoothX = math.lerp(currentCard.position.x, targetPos.x, 0.45); // Slightly tighter follow
                const smoothY = math.lerp(currentCard.position.y, targetPos.y, 0.45);

                currentCard.setPosition(smoothX, smoothY, 0);
                currentCard.angle = math.lerp(currentCard.angle, prevCard.angle * 0.9, 0.2);
            }

            // 🌟 UX IMPROVEMENT: PREDICTIVE HIGHLIGHTING
            // Check what we are hovering over every frame to give feedback
            this.checkAndHighlightTarget();
        }
    }

    onDragEnd(event: EventTouch) {

        if (this.gameManager) this.gameManager.resetIdleTimer();
        
        this.node.off(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
        this._isDragging = false;
        
        // 🌟 CLEAR HIGHLIGHTS
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

    // 🌟 UX: Highlight the valid target under the dragged card
    checkAndHighlightTarget() {
        const headCard = this._draggedCards[0];
        const headTrans = headCard.getComponent(UITransform);
        const headWorldPos = headCard.getWorldPosition(); // Center of card

        const targets = [...this.gameManager.tableauNodes, ...this.gameManager.foundationNodes];
        let foundTarget: CardLogic | null = null;

        // Find closest valid target
        let minDist = 200; // Detection radius

        for (const targetNode of targets) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic || targetLogic === this) continue;
            
            // Get the "Hotspot" of the target (Center of the last card or placeholder)
            let targetHotspot = targetNode.getWorldPosition();
            const targetChildren = targetLogic.node.children.filter(c => c.active && c.name.startsWith("card"));
            if (targetChildren.length > 0) {
                targetHotspot = targetChildren[targetChildren.length - 1].getWorldPosition();
            }

            const dist = Vec3.distance(headWorldPos, targetHotspot);

            if (dist < minDist) {
                // Only highlight if it's a VALID move
                if (this.checkSpecificDropValidity(headCard, targetLogic)) {
                    minDist = dist;
                    foundTarget = targetLogic;
                }
            }
        }

        // State Change Logic
        if (foundTarget !== this._activeHighlightTarget) {
            // Unhighlight old
            if (this._activeHighlightTarget) this._activeHighlightTarget.setHighlightState(false);
            
            // Highlight new
            if (foundTarget) foundTarget.setHighlightState(true);
            
            this._activeHighlightTarget = foundTarget;
        }
    }

    // 🌟 UX: Visual Feedback on the Target Pile
    public setHighlightState(isActive: boolean) {
        // 1. Find the best target to animate (Top card or Placeholder)
        let targetVisual: Node | null = null;

        // Filter specifically for "Card" nodes that are active, ignoring the placeholder
        const activeCards = this.node.children.filter(c => 
            c.active && 
            c !== this.placeholderNode && 
            (c.name.startsWith("card") || c.name.includes("faceDown"))
        );

        if (activeCards.length > 0) {
            // If there are cards, highlight the top one
            targetVisual = activeCards[activeCards.length - 1];
        } else {
            // If empty, highlight the placeholder (ONLY if it exists)
            if (this.placeholderNode && isValid(this.placeholderNode)) {
                targetVisual = this.placeholderNode;
            }
        }

        // 2. Safety Check: If no target was found (e.g., empty pile & unassigned placeholder), exit.
        if (!targetVisual) return;

        // 3. Execute Animation
        Tween.stopAllByTarget(targetVisual);

        if (isActive) {
            // "Pop" up to greet the incoming card
            tween(targetVisual)
                .to(0.15, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'sineOut' })
                .start();
        } else {
            // Return to normal
            tween(targetVisual)
                .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
                .start();
        }
    }

    startDraggingVisuals() {
        const overlay = this.gameManager.globalOverlay;
        if (!overlay) return;

        const overlayTrans = overlay.getComponent(UITransform);
        this._originalParent = this.node;
        
        // 🌟 FIX PHASE 1: Capture ALL data BEFORE moving anything!
        // If we move inside the loop, indices of remaining cards shift, causing incorrect data.
        this._originalPositions = this._draggedCards.map(c => c.getPosition().clone());
        this._originalSiblingIndices = this._draggedCards.map(c => c.getSiblingIndex());

        // 🌟 FIX PHASE 2: Now it is safe to move them to the overlay
        this._draggedCards.forEach((card, index) => {
            const startWorldScale = card.getWorldScale().clone();   

            const worldPos = card.getWorldPosition();
            const localOverlayPos = overlayTrans.convertToNodeSpaceAR(worldPos);

            card.setParent(overlay);
            card.setPosition(localOverlayPos);
            card.setWorldScale(startWorldScale); 
            
            // Pop effect on pickup
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
        
        const targets = [...this.gameManager.tableauNodes, ...this.gameManager.foundationNodes];
        let bestTarget: CardLogic | null = null;
        let closestDist = 1000;

        // 🌟 UX IMPROVEMENT: PROXIMITY CHECK (FORGIVING HITBOX)
        // Instead of strict rectangle intersection, check distance to the "heart" of the target.
        // This allows dropping "near" the pile and having it snap in.
        
        for (const targetNode of targets) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic || targetLogic === this) continue;

            // Determine drop point (Last card or placeholder)
            let targetDropPoint = targetNode.getWorldPosition();
            const children = targetLogic.node.children.filter(c => c.active && c.name.startsWith("card"));
            if (children.length > 0) {
                targetDropPoint = children[children.length - 1].getWorldPosition();
            }

            const dist = Vec3.distance(headWorldPos, targetDropPoint);

            // Distance threshold (approx 1 card width)
            if (dist < 150) { 
                if (dist < closestDist) {
                    if (this.checkSpecificDropValidity(headCard, targetLogic)) {
                        closestDist = dist;
                        bestTarget = targetLogic;
                    }
                }
            }
        }

        if (bestTarget) {
            console.log(`[CardLogic] 🎯 Drop valid on ${bestTarget.node.name}`);
            this._draggedCards.forEach(c => {
                const op = c.getComponent(UIOpacity) || c.addComponent(UIOpacity);
                op.opacity = 255;
            });
            this.executeStackMove(this._draggedCards, bestTarget);
            
            // 🌟 FIX ADDED HERE: Clear the dragged cards array so subsequent actions don't try to use an old array state
            this._draggedCards = []; 
        } else {
            this.returnCardsToOriginal();
        }
    }

    checkSpecificDropValidity(dragHead: Node, targetLogic: CardLogic): boolean {

        // 🌟 FIX: Instantly reject drops on currently animating targets
        if (targetLogic.getAnimationLock()) return false;
        const dragData = this.getCardData(dragHead);
        if (!dragData) return false;

        const targetChildren = targetLogic.node.children.filter(c => 
            c.active && c !== targetLogic.placeholderNode && c.name.startsWith("card")
        );

        const isTargetEmpty = targetChildren.length === 0;

        if (isTargetEmpty) {
            if (targetLogic.holderType === HolderType.TABLEAU) {
                return dragData.value === 12; // King only
            } else if (targetLogic.holderType === HolderType.FOUNDATION) {
                return dragData.value === 0 && this._draggedCards.length === 1;
            }
        } 
        else {
            const topTarget = targetChildren[targetChildren.length - 1];
            const targetData = this.getCardData(topTarget);
            if (!targetData) return false;

            if (targetLogic.holderType === HolderType.TABLEAU) {
                return (dragData.isRed !== targetData.isRed) && (targetData.value === dragData.value + 1);
            } else if (targetLogic.holderType === HolderType.FOUNDATION) {
                return (dragData.suit === targetData.suit) && (dragData.value === targetData.value + 1) && this._draggedCards.length === 1;
            }
        }
        return false;
    }

    returnCardsToOriginal() {
        console.log("[CardLogic] ↩️ Drop invalid. Returning.");
        // 🌟 FIX ADDED HERE: Lock the animation state so rapid inputs are ignored
        this._isAnimating = true; 

        const overlayTrans = this.gameManager.globalOverlay.getComponent(UITransform);
        const parentTrans = this._originalParent.getComponent(UITransform);

        // Counter to track when animations are done
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
                    
                    // 🌟 FIX: Only restore the stack when the LAST card arrives.
                    // This prevents race conditions that reverse the order.
                    if (completedCount === totalCards) {
                        this.finalizeReturn();
                    }
                })
                .start();
        });
    }

    // Helper to restore order safely
    finalizeReturn() {
        this._draggedCards.forEach((card, index) => {
            // 1. Put back in parent
            card.setParent(this._originalParent);
            
            // 2. Reset Position
            card.setPosition(this._originalPositions[index]);
            
            // 3. Restore strict order
            // Since we captured the indices correctly now, this will restore the exact order.
            card.setSiblingIndex(this._originalSiblingIndices[index]);
            
            // 4. Ensure opacity is back
            const op = card.getComponent(UIOpacity) || card.addComponent(UIOpacity);
            op.opacity = 255;
        });

        this._draggedCards = [];
        
        // 🌟 FIX ADDED HERE: Unlock the interaction state so the user can grab cards from this pile again
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
        if (this.holderType === HolderType.FOUNDATION) {
            this.playSFX(this.errorSound);
            this.showWrongFeedback(event, null);
            return;
        }

        if (this._isAnimating) return;

        if (this.holderType === HolderType.STOCK) {
            this.handleStockClick();
            return;
        }

        const activeFlippers = this.node.getComponentsInChildren(CardFlipper);
        if (activeFlippers.some(flipper => flipper.isFlipping)) return; 

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

            if (topData && this.findFoundationMove(topData, [topCard])) {
                return; 
            }

            if (this.holderType === HolderType.WASTE) {
                if (topData && this.findValidMove(topData, [topCard])) {
                    return; 
                }
            } else {
                for (let i = 0; i < faceUpCards.length; i++) {
                    const headCard = faceUpCards[i];
                    const headData = this.getCardData(headCard);
                    const subStack = faceUpCards.slice(i); 
                    
                    if (headData && this.findValidMove(headData, subStack)) {
                        return;
                    }
                }
            }
        }

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
            // this.playSFX(this.successSound);
            this._isAnimating = true;
            topCard.setSiblingIndex(this.node.children.length - 1); 

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
                this.playSFX(this.errorSound);
                return;
            }

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

        // 🌟 FIX: Lock both the source and the target immediately
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

                            // 🌟 FIX: Unlock when finished
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
                                
                                // 🌟 FIX: Unlock both the target and the source now that animation is fully done
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

    findFoundationMove(movingData: CardData, sequence: Node[]): boolean {
        if (sequence.length > 1) return false; 
        if (!this.gameManager || !this.gameManager.foundationNodes) return false;
        
        for (const targetNode of this.gameManager.foundationNodes) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic) continue;

            // 🌟 FIX: Ignore targets that are currently animating
            if (targetLogic.getAnimationLock()) continue;

            const targetCards = targetLogic.node.children.filter(c => c.name.startsWith("card") && !c.name.includes("foundation_A"));
            const isTargetEmpty = targetCards.length === 0;

            if (isTargetEmpty && movingData.value === 0) {
                this.executeStackMove(sequence, targetLogic);
                return true;
            }

            if (!isTargetEmpty) {
                const topTargetCard = targetCards[targetCards.length - 1];
                const targetData = this.getCardData(topTargetCard);
                if (targetData && targetData.suit === movingData.suit && movingData.value === targetData.value + 1) {
                    this.executeStackMove(sequence, targetLogic);
                    return true;
                }
            }
        }
        return false;
    }

    findValidMove(movingData: CardData, sequence: Node[]): boolean {
        if (!this.gameManager || !this.gameManager.tableauNodes) return false;
        
        for (const targetNode of this.gameManager.tableauNodes) {
            const target = targetNode.getComponent(CardLogic);
            if (!target || target === this || target.holderType !== HolderType.TABLEAU) continue; 
            
            // 🌟 FIX: Ignore targets that are currently animating
            if (target.getAnimationLock()) continue;

            const targetChildren = target.node.children.filter(c => 
                c !== target.placeholderNode && 
                (c.name.startsWith("card") || c.name.includes("faceDown"))
            );

            const isTargetEmpty = targetChildren.length === 0;

            if (isTargetEmpty) {
                if (movingData.value === 12) { 
                    this.executeStackMove(sequence, target);
                    return true;
                }
            } else {
                const bottomTarget = targetChildren[targetChildren.length - 1];
                const targetData = this.getCardData(bottomTarget); 
                if (targetData && (targetData.isRed !== movingData.isRed) && (targetData.value === movingData.value + 1)) {
                    this.executeStackMove(sequence, target);
                    return true;
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
        
        // 🌟 FIX: Parent to globalOverlay so it doesn't hide behind the Tableau/Foundation
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