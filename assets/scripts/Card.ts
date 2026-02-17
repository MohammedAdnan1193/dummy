import { _decorator, Component, Node, Vec3, UITransform, tween, isValid, SpriteFrame, Sprite, UIOpacity, EventTouch, Layout, AudioSource, AudioClip, Enum, Rect, Vec2 } from 'cc';
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

    @property({ type: Node, tooltip: "The visual card back covering the stock pile (Stock Only)" })
    public visualDeckTop: Node = null!;

    @property({ type: Node, tooltip: "Visual to show when Stock AND Waste are completely empty (No Reset)" })
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

    // --- DRAG AND DROP STATE ---
    private _isDragging: boolean = false;
    private _dragThresholdPassed: boolean = false;
    private _dragStartPos: Vec2 = new Vec2();
    private _dragOffset: Vec3 = new Vec3();
    private _draggedCards: Node[] = [];
    
    // To return cards if drop fails
    private _originalParent: Node = null!;
    private _originalPositions: Vec3[] = [];
    private _originalSiblingIndices: number[] = [];

    onLoad() {
        console.log(`[CardLogic] 🟢 INITIALIZING ${this.node.name} (Type: ${HolderType[this.holderType]})`);
        this._audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        
        // We bind the touch start. Move/End are bound dynamically.
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        
        this.updatePlaceholderVisibility();
    }

    // =========================================================================
    // ✋ TOUCH & DRAG LOGIC
    // =========================================================================

    onTouchStart(event: EventTouch) {
        if (this.gameManager) this.gameManager.resetIdleTimer();

        // 1. Foundation/Stock usually don't support dragging OUT (Foundation is strict, Stock is click-only)
        if (this.holderType === HolderType.STOCK || this.holderType === HolderType.FOUNDATION) {
            this.handleStandardClick(event); // Treat as normal click immediately
            return;
        }

        const touchUILoc = event.getUILocation();
        
        // 2. Find which card was touched
        const clickedCard = this.getCardUnderTouch(touchUILoc);
        
        // If we touched empty space or a face-down card, treat as normal click logic (e.g., auto-flip)
        if (!clickedCard || clickedCard.name.includes("faceDown")) {
            this.handleStandardClick(event);
            return;
        }

        // 3. Prepare Drag Data
        const allChildren = this.node.children;
        const index = allChildren.indexOf(clickedCard);
        
        // Get the stack: The clicked card + everything physically above it
        this._draggedCards = allChildren.slice(index).filter(c => c.active && c !== this.placeholderNode);

        if (this._draggedCards.length === 0) return;

        // 4. Initialize Drag State
        this._isDragging = true;
        this._dragThresholdPassed = false;
        this._dragStartPos.set(touchUILoc.x, touchUILoc.y);

        // Calculate offset so the card doesn't snap to center of finger
        const cardWorldPos = clickedCard.getWorldPosition();
        this._dragOffset.set(cardWorldPos.x - touchUILoc.x, cardWorldPos.y - touchUILoc.y, 0);

        // 5. Listen for Move/End
        this.node.on(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
    }

    onDragMove(event: EventTouch) {
        if (!this._isDragging) return;

        const uiLoc = event.getUILocation();

        // 1. Check Threshold (prevent jittery clicks from becoming drags)
        if (!this._dragThresholdPassed) {
            const dist = Vec2.distance(this._dragStartPos, uiLoc);
            if (dist > 10) { // 10px threshold
                this._dragThresholdPassed = true;
                this.startDraggingVisuals(); // Move cards to Overlay
            } else {
                return; // Wait until threshold passed
            }
        }

        // 2. Move the cards in the Overlay
        if (this._draggedCards.length > 0 && this.gameManager.globalOverlay) {
            const overlayTransform = this.gameManager.globalOverlay.getComponent(UITransform);
            
            // Calculate Head Position
            const worldPos = new Vec3(uiLoc.x, uiLoc.y, 0).add(this._dragOffset);
            const localPos = overlayTransform.convertToNodeSpaceAR(worldPos);

            // Move Head
            this._draggedCards[0].setPosition(localPos);

            // Move Tail (Simple vertical stack logic for visual consistency while dragging)
            for (let i = 1; i < this._draggedCards.length; i++) {
                const prev = this._draggedCards[i-1];
                // Maintain current offset. Assuming roughly -40y for Tableau
                this._draggedCards[i].setPosition(prev.position.x, prev.position.y - 45, 0);
            }
        }
    }

    onDragEnd(event: EventTouch) {
        // Unbind listeners
        this.node.off(Node.EventType.TOUCH_MOVE, this.onDragMove, this);
        this.node.off(Node.EventType.TOUCH_END, this.onDragEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onDragEnd, this);
        this._isDragging = false;

        // CASE A: It was just a tap (Threshold not passed)
        if (!this._dragThresholdPassed) {
            this._draggedCards = []; // Clear ref
            this.handleStandardClick(event);
            return;
        }

        // CASE B: It was a Drag - Check for Drop Target
        this.attemptDrop();
    }

    startDraggingVisuals() {
        const overlay = this.gameManager.globalOverlay;
        if (!overlay) return;

        const overlayTrans = overlay.getComponent(UITransform);
        this._originalParent = this.node;
        this._originalPositions = [];
        this._originalSiblingIndices = [];

        this._draggedCards.forEach(card => {
            // Save state for potential snap-back
            this._originalPositions.push(card.getPosition().clone());
            this._originalSiblingIndices.push(card.getSiblingIndex());

            // Convert to Overlay Space
            const worldPos = card.getWorldPosition();
            const localOverlayPos = overlayTrans.convertToNodeSpaceAR(worldPos);

            card.setParent(overlay);
            card.setPosition(localOverlayPos);
            card.parent.setScale(new Vec3(0.7, 0.7, 1))
            
            // Visual feedback
            const op = card.getComponent(UIOpacity) || card.addComponent(UIOpacity);
            op.opacity = 255; 
        });
    }

    attemptDrop() {
        const headCard = this._draggedCards[0];
        const headTrans = headCard.getComponent(UITransform);
        const headRect = headTrans.getBoundingBoxToWorld();

        // Collect all possible targets
        const targets = [...this.gameManager.tableauNodes, ...this.gameManager.foundationNodes];
        
        let dropped = false;

        for (const targetNode of targets) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic || targetLogic === this) continue;

            const targetTrans = targetNode.getComponent(UITransform);
            const targetRect = targetTrans.getBoundingBoxToWorld();

            // Check Collision
            if (targetRect.intersects(headRect)) {
                // Check Logic Validity
                if (this.checkSpecificDropValidity(headCard, targetLogic)) {
                    console.log(`[CardLogic] 🎯 Drop valid on ${targetNode.name}`);
                    
                    // Reset opacity
                    this._draggedCards.forEach(c => c.getComponent(UIOpacity)!.opacity = 255);
                    
                    // Execute Logic
                    this.executeStackMove(this._draggedCards, targetLogic);
                    dropped = true;
                    break;
                }
            }
        }

        if (!dropped) {
            this.returnCardsToOriginal();
        }
    }

    checkSpecificDropValidity(dragHead: Node, targetLogic: CardLogic): boolean {
        const dragData = this.getCardData(dragHead);
        if (!dragData) return false;

        const targetChildren = targetLogic.node.children.filter(c => 
            c.active && c !== targetLogic.placeholderNode && c.name.startsWith("card")
        );

        const isTargetEmpty = targetChildren.length === 0;

        // 1. Target is Empty
        if (isTargetEmpty) {
            if (targetLogic.holderType === HolderType.TABLEAU) {
                return dragData.value === 12; // King only
            } else if (targetLogic.holderType === HolderType.FOUNDATION) {
                // Foundation only accepts Ace (0) and SINGLE cards
                return dragData.value === 0 && this._draggedCards.length === 1;
            }
        } 
        // 2. Target has Cards
        else {
            const topTarget = targetChildren[targetChildren.length - 1];
            const targetData = this.getCardData(topTarget);
            if (!targetData) return false;

            if (targetLogic.holderType === HolderType.TABLEAU) {
                // Tableau Rule: Opposite Color, Value - 1
                return (dragData.isRed !== targetData.isRed) && (targetData.value === dragData.value + 1);
            } else if (targetLogic.holderType === HolderType.FOUNDATION) {
                // Foundation Rule: Same Suit, Value + 1, Single Card only
                return (dragData.suit === targetData.suit) && (dragData.value === targetData.value + 1) && this._draggedCards.length === 1;
            }
        }

        return false;
    }

    returnCardsToOriginal() {
        console.log("[CardLogic] ↩️ Drop invalid. Returning.");
        const overlayTrans = this.gameManager.globalOverlay.getComponent(UITransform);
        const parentTrans = this._originalParent.getComponent(UITransform);

        this._draggedCards.forEach((card, index) => {
            const originalPos = this._originalPositions[index];
            
            // Calculate where that original local spot is currently in World space
            const worldDest = parentTrans.convertToWorldSpaceAR(originalPos);
            // Convert that to Overlay space for the tween target
            const overlayDest = overlayTrans.convertToNodeSpaceAR(worldDest);

            tween(card)
                .to(0.2, { position: overlayDest }, { easing: 'sineOut' })
                .call(() => {
                    card.setParent(this._originalParent);
                    card.setPosition(originalPos);
                    card.setSiblingIndex(this._originalSiblingIndices[index]);
                    card.getComponent(UIOpacity)!.opacity = 255;
                })
                .start();
        });

        this._draggedCards = [];
    }

    getCardUnderTouch(uiLoc: Vec2): Node | null {
        // Check children from Top (Last) to Bottom (0)
        for (let i = this.node.children.length - 1; i >= 0; i--) {
            const child = this.node.children[i];
            if (!child.active || child === this.placeholderNode) continue;

            const trans = child.getComponent(UITransform);
            // FIX: isHit expects a Vec2, not a Vec3
            if (trans && trans.isHit(uiLoc)) {
                return child;
            }
        }
        return null;
    }


    // =========================================================================
    // 🧠 ORIGINAL CLICK LOGIC (Now "HandleStandardClick")
    // =========================================================================

    handleStandardClick(event: EventTouch) {
        if (this.holderType === HolderType.FOUNDATION) {
            console.log(`[CardLogic] ❌ Clicks on Foundation are disabled.`);
            this.playSFX(this.errorSound);
            this.showWrongFeedback(event);
            return;
        }

        if (this.holderType === HolderType.STOCK) {
            this.handleStockClick();
            return;
        }

        const activeFlippers = this.node.getComponentsInChildren(CardFlipper);
        if (activeFlippers.some(flipper => flipper.isFlipping)) {
            console.warn(`[CardLogic] 🛑 INPUT BLOCKED: Animation in progress.`);
            return; 
        }

        const faceUpCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            c !== this.visualDeckTop &&
            c !== this.emptyStockVisual &&
            c.active &&
            c.name.startsWith("card") 
        );

        console.log(`[CardLogic] 🃏 Found ${faceUpCards.length} face-up playable cards in this stack.`);

        if (faceUpCards.length > 0) {
            // --- 1. PRIORITY: CHECK FOUNDATION (Always Top Card Only) ---
            const topCard = faceUpCards[faceUpCards.length - 1];
            const topData = this.getCardData(topCard);

            console.log(`[CardLogic] 🔍 Checking Foundation move for Top Card: ${topCard.name}`);
            if (topData && this.findFoundationMove(topData, [topCard])) {
                return; 
            }

            // --- 2. CHECK TABLEAU MOVES (Iterate from Bottom Up) ---
            if (this.holderType === HolderType.WASTE) {
                // Waste Pile Restriction: Can ONLY move the single top card
                console.log(`[CardLogic] 🔍 Checking Tableau moves for Waste Card: ${topCard.name}`);
                if (topData && this.findValidMove(topData, [topCard])) {
                    return; 
                }
            } else {
                // Tableau Logic: Try to move the whole stack, then sub-stacks
                for (let i = 0; i < faceUpCards.length; i++) {
                    const headCard = faceUpCards[i];
                    const headData = this.getCardData(headCard);

                    // The "Train" is the head card + everything sitting on top of it
                    const subStack = faceUpCards.slice(i); 

                    console.log(`[CardLogic] 🔍 Checking Split at index ${i}: Head=${headCard.name} (Moving ${subStack.length} cards)`);
                    
                    if (headData && this.findValidMove(headData, subStack)) {
                        return; // Found a valid move! Stop checking.
                    }
                }
            }
        }

        console.log(`[CardLogic] ❌ No valid moves found for click on ${this.node.name}`);
        this.playSFX(this.errorSound);
        this.showWrongFeedback(event);
    }

    // =========================================================================
    // 🛠️ DATA & UTILS
    // =========================================================================

    getCardData(cardNode: Node): CardData | null {
        // Log rejected nodes for debugging
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
        
        if (isNaN(index)) {
            console.warn(`[CardLogic] ⚠️ Failed to parse index from card name: ${cardNode.name}`);
            return null;
        }

        return {
            value: index % 13,
            suit: Math.floor(index / 13),
            isRed: (Math.floor(index / 13) === 1 || Math.floor(index / 13) === 2),
            node: cardNode
        };
    }

    private handleStockClick() {
        if (!this.gameManager || !this.gameManager.wasteNode) {
            console.error("[CardLogic] ❌ Stock click failed: wasteNode not linked.");
            return;
        }

        if (this.emptyStockVisual && this.emptyStockVisual.active) {
            console.log("[CardLogic] ⛔ Stock is permanently empty (No Reset). Click ignored.");
            return;
        }

        const wasteNode = this.gameManager.wasteNode;
        const wasteLogic = wasteNode.getComponent(CardLogic);

        const stockCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            c !== this.visualDeckTop && 
            c !== this.emptyStockVisual &&
            c.name.startsWith("card")
        );

        if (stockCards.length > 0) {
            // --- DRAW PHASE ---
            const topCard = stockCards[stockCards.length - 1];
            console.log(`[CardLogic] 🎴 ACTION: Draw ${topCard.name} -> Waste`);
            
            this.playSFX(this.successSound);
            topCard.setSiblingIndex(this.node.children.length - 1); 

            if (wasteLogic) {
                this.executeStackMove([topCard], wasteLogic);
                const flipper = topCard.getComponent(CardFlipper);
                if (flipper) flipper.flipToFaceUp();
            }

            if (stockCards.length - 1 === 0 && this.visualDeckTop) {
                this.visualDeckTop.active = false;
            }

        } else {
            // --- RECYCLE PHASE ---
            console.log(`[CardLogic] ♻️ Stock empty. Attempting Recycle...`);
            
            const wasteCards = wasteNode.children.filter(c => 
                c.name.startsWith("card") && c !== wasteLogic?.placeholderNode
            );

            if (wasteCards.length === 0) {
                console.log(`[CardLogic] 🛑 Waste is also empty. Deck depleted.`);
                if (this.emptyStockVisual) this.emptyStockVisual.active = true;
                if (this.placeholderNode) this.placeholderNode.active = false;
                if (this.visualDeckTop) this.visualDeckTop.active = false;
                this.playSFX(this.errorSound);
                return;
            }

            this.playSFX(this.successSound); 
            const reversedWaste = wasteCards.reverse();

            reversedWaste.forEach(card => {
                card.setParent(this.node);
                card.setPosition(0, 0, 0); 
                const flipper = card.getComponent(CardFlipper);
                if (flipper) flipper.setFaceDown();
            });

            if (this.visualDeckTop) {
                this.visualDeckTop.active = true;
                this.visualDeckTop.setSiblingIndex(this.node.children.length - 1);
            }

            this.updatePlaceholderVisibility();
            if (wasteLogic) wasteLogic.updatePlaceholderVisibility();
        }
    }

    findFoundationMove(movingData: CardData, sequence: Node[]): boolean {
        if (sequence.length > 1) return false; 

        if (!this.gameManager || !this.gameManager.foundationNodes) return false;
        
        const foundationNodes = this.gameManager.foundationNodes;

        for (const targetNode of foundationNodes) {
            const targetLogic = targetNode.getComponent(CardLogic);
            if (!targetLogic) continue;

            const targetCards = targetLogic.node.children.filter(c => 
                c.name.startsWith("card") && !c.name.includes("foundation_A")
            );

            const isTargetEmpty = targetCards.length === 0;

            if (isTargetEmpty && movingData.value === 0) {
                console.log(`[CardLogic] 🌟 SUCCESS: Ace (${movingData.node.name}) -> Empty Foundation (${targetLogic.node.name})`);
                this.executeStackMove(sequence, targetLogic);
                return true;
            }

            if (!isTargetEmpty) {
                const topTargetCard = targetCards[targetCards.length - 1];
                const targetData = this.getCardData(topTargetCard);
                
                if (targetData && targetData.suit === movingData.suit && movingData.value === targetData.value + 1) {
                    console.log(`[CardLogic] 🌟 SUCCESS: ${movingData.node.name} -> Foundation (${topTargetCard.name})`);
                    this.executeStackMove(sequence, targetLogic);
                    return true;
                }
            }
        }
        return false;
    }

    findValidMove(movingData: CardData, sequence: Node[]): boolean {
        if (!this.gameManager || !this.gameManager.tableauNodes) return false;
        
        console.log(`[CardLogic] 🔎 SEARCHING TABLEAU MOVES for: ${movingData.node.name} (Value: ${movingData.value}, Red: ${movingData.isRed})`);

        const allHolderNodes = this.gameManager.tableauNodes;
        
        for (const targetNode of allHolderNodes) {
            const target = targetNode.getComponent(CardLogic);
            
            // Skip invalid targets
            if (!target || target === this || target.holderType !== HolderType.TABLEAU) continue; 
            
            const targetChildren = target.node.children.filter(c => 
                c !== target.placeholderNode && 
                (c.name.startsWith("card") || c.name.includes("faceDown"))
            );

            const isTargetEmpty = targetChildren.length === 0;

            // RULE 1: KING TO EMPTY
            if (isTargetEmpty) {
                if (movingData.value === 12) { // 12 is King
                    this.executeStackMove(sequence, target);
                    return true;
                }
            }

            // RULE 2: STANDARD STACKING
            if (!isTargetEmpty) {
                const bottomTarget = targetChildren[targetChildren.length - 1];
                const targetData = this.getCardData(bottomTarget); 
                
                if (targetData) {
                    const colorMatch = targetData.isRed !== movingData.isRed;
                    const valueMatch = targetData.value === movingData.value + 1;

                    if (colorMatch && valueMatch) {
                        this.executeStackMove(sequence, target);
                        return true;
                    }
                }
            }
        }
        return false;
    }

    executeStackMove(nodesToMove: Node[], target: CardLogic) {
        if (!this.gameManager || !this.gameManager.globalOverlay) {
            console.error("[CardLogic] ERROR: GameManager/Overlay missing");
            return;
        }

        const overlay = this.gameManager.globalOverlay;
        const overlayTransform = overlay.getComponent(UITransform);
        const targetLayout = target.getComponent(Layout);
        
        if (this.gameManager) this.gameManager.addValidMove(this.node); 
        
        console.log(`[CardLogic] >>> EXECUTE MOVE: Moving ${nodesToMove.length} cards to ${target.node.name}`);

        const startWorldPositions = nodesToMove.map(node => node.getWorldPosition().clone());
        const startWorldScales = nodesToMove.map(node => node.getWorldScale().clone());
        
        // Reparent to Target immediately (Logic)
        nodesToMove.forEach(cardNode => {
            const op = cardNode.getComponent(UIOpacity) || cardNode.addComponent(UIOpacity);
            op.opacity = 0; 
            cardNode.setParent(target.node); 
        });

        // Update layouts to get final positions
        target.updatePlaceholderVisibility(); 
        if (targetLayout) targetLayout.updateLayout(); 
        this.updatePlaceholderVisibility(); 

        target.node.updateWorldTransform(); 
        nodesToMove.forEach(node => node.updateWorldTransform()); 

        const finalWorldPositions = nodesToMove.map(node => node.getWorldPosition().clone());
        const finalLocalPositions = nodesToMove.map(node => node.getPosition().clone());

        // Temporarily move to Overlay for Animation
        nodesToMove.forEach((cardNode, index) => {
            cardNode.setParent(overlay);
            cardNode.setWorldPosition(startWorldPositions[index]);
            // Keep the scale it had during drag/start
            cardNode.setWorldScale(startWorldScales[index]); 
            cardNode.getComponent(UIOpacity)!.opacity = 255; 
        });

        nodesToMove.forEach((cardNode, index) => {
            let targetPosInOverlay = new Vec3();
            if (overlayTransform) {
                targetPosInOverlay = overlayTransform.convertToNodeSpaceAR(finalWorldPositions[index]);
            } else {
                targetPosInOverlay = finalWorldPositions[index]; 
            }

            tween(cardNode)
                .to(0.35 + (index * 0.04), { position: targetPosInOverlay }, { 
                    easing: 'sineOut', 
                    onComplete: () => {
                        // Place back in target
                        if (isValid(target.node) && isValid(cardNode)) {
                            cardNode.setParent(target.node);
                            cardNode.setPosition(finalLocalPositions[index]);
                            
                            // 🛑 CRITICAL FIX:
                            // Reset Local Scale to (1, 1, 1) immediately.
                            // This ensures it adopts the Holder's scale (0.6) exactly, 
                            // preventing the "accumulating scale" bug.
                            cardNode.setScale(new Vec3(1, 1, 1));

                            if (index === nodesToMove.length - 1) {
                                console.log(`[CardLogic] <<< MOVE COMPLETE`);
                                this.playSuccessEffect(cardNode); 
                                this.checkAndFlipRevealedCard(); 
                                if (targetLayout) targetLayout.updateLayout();

                                if (this.holderType === HolderType.WASTE) {
                                    this.checkDeckDepletion();
                                }
                            }
                        }
                    }
                })
                .start();
        });
    }

    private checkDeckDepletion() {
        if (!this.gameManager || !this.gameManager.stockNode) return;

        const wasteCards = this.node.children.filter(c => 
            c.name.startsWith("card") && c !== this.placeholderNode
        );

        if (wasteCards.length > 0) return; 

        const stockNode = this.gameManager.stockNode;
        const stockLogic = stockNode.getComponent(CardLogic);
        
        const stockCards = stockNode.children.filter(c => 
            c.name.startsWith("card") || c.name.includes("faceDown")
        );
        
        const validStockCards = stockCards.filter(c => 
             c !== stockLogic?.visualDeckTop && c !== stockLogic?.emptyStockVisual
        );

        if (validStockCards.length === 0) {
            console.log("[CardLogic] 🛑 DECK DEPLETED: Waste move emptied the entire deck.");
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
                console.log(`[CardLogic] 🔀 Auto-flipping revealed card: ${lastCard.name}`);
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

    private showWrongFeedback(event: EventTouch) {
        let targetParent = this.node;
        if (this.gameManager && this.gameManager.globalOverlay) {
            targetParent = this.gameManager.globalOverlay;
        } else if (this.gameManager && this.gameManager.node) {
            targetParent = this.gameManager.node;
        } else {
            targetParent = this.node.parent || this.node;
        }

        const touchPos = event.getUILocation();
        const worldPos = new Vec3(touchPos.x, touchPos.y, 0);
        const parentTrans = targetParent.getComponent(UITransform);
        const localPos = parentTrans ? parentTrans.convertToNodeSpaceAR(worldPos) : worldPos;

        const feedbackNode = new Node('WrongClickFeedback');
        targetParent.addChild(feedbackNode);
        feedbackNode.setPosition(localPos);

        const sprite = feedbackNode.addComponent(Sprite);
        sprite.spriteFrame = this.wrongClickSprite;

        const uiOpacity = feedbackNode.addComponent(UIOpacity);
        const transform = feedbackNode.addComponent(UITransform);

        transform.setContentSize(80, 80);
        feedbackNode.setScale(new Vec3(0, 0, 1)); 

        tween(feedbackNode)
            .to(0.1, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
            .to(0.1, { scale: new Vec3(1.0, 1.0, 1) }, { easing: 'sineOut' })
            .delay(0.3) 
            .call(() => {
                tween(uiOpacity)
                    .to(0.2, { opacity: 0 })
                    .call(() => {
                        if (isValid(feedbackNode)) feedbackNode.destroy();
                    })
                    .start();
            })
            .start();
    }

    private playSFX(clip: AudioClip) {
        if (clip && this._audioSource) this._audioSource.playOneShot(clip, 1.0); 
    }

    private playSuccessEffect(targetNode: Node) {
        this.playSFX(this.successSound);

        const effectContainer = new Node('EffectContainer');
        this.node.parent?.addChild(effectContainer); 
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
        tween(ring)
            .to(ringDuration, { scale: new Vec3(2.0, 2.0, 1) }, { easing: 'backOut' })
            .start();

        tween(ringOpacity)
            .delay(ringDuration * 0.3)
            .to(ringDuration * 0.7, { opacity: 0 })
            .start();

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

            tween(particle)
                .to(lifetime, { position: new Vec3(endX, endY, 0) }, { easing: 'sineOut' })
                .start();

            tween(pOpacity)
                .to(lifetime * 0.7, { opacity: 255 })
                .to(lifetime * 0.3, { opacity: 0 })
                .start();

            tween(particle)
                .to(lifetime, { scale: new Vec3(0.05, 0.05, 1) }, { easing: 'sineIn' })
                .start();
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