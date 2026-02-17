import { _decorator, Component, Node, Vec3, UITransform, tween, isValid, SpriteFrame, Sprite, UIOpacity, EventTouch, Layout, AudioSource, AudioClip, Enum } from 'cc';
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

    onLoad() {
        console.log(`[CardLogic] 🟢 INITIALIZING ${this.node.name} (Type: ${HolderType[this.holderType]})`);
        this._audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this.node.on(Node.EventType.TOUCH_START, this.onHolderClicked, this);
        this.updatePlaceholderVisibility();
    }

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

        const data = {
            value: index % 13,
            suit: Math.floor(index / 13),
            isRed: (Math.floor(index / 13) === 1 || Math.floor(index / 13) === 2),
            node: cardNode
        };

        // Verbose data log (Optional: Comment out if too noisy)
        // console.log(`[CardLogic] 📄 Parsed Data for ${cardNode.name}: Value=${data.value}, Red=${data.isRed}`);
        return data;
    }

    onHolderClicked(event: EventTouch) {
        if (this.gameManager) this.gameManager.resetIdleTimer();
        
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
                // We loop from 0 (Bottom) to length-1 (Top)
                // This ensures we prioritize moving the LARGEST possible stack first.
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
                console.log(`[CardLogic]    > Checking Empty Column: ${target.node.name}`);
                if (movingData.value === 12) { // 12 is King
                    console.log(`[CardLogic]      ✅ KING RULE PASS: Moving King to empty column.`);
                    this.executeStackMove(sequence, target);
                    return true;
                } else {
                    console.log(`[CardLogic]      ❌ KING RULE FAIL: Card is not a King (Value: ${movingData.value}).`);
                }
            }

            // RULE 2: STANDARD STACKING
            if (!isTargetEmpty) {
                const bottomTarget = targetChildren[targetChildren.length - 1];
                const targetData = this.getCardData(bottomTarget); 
                
                // Logging specifically for RULE 2 as requested
                if (targetData) {
                    console.log(`[CardLogic] [RULE 2 CHECK] vs Target: ${bottomTarget.name} in ${target.node.name}`);
                    console.log(`[CardLogic]      > Moving Card: Val=${movingData.value}, Red=${movingData.isRed}`);
                    console.log(`[CardLogic]      > Target Card: Val=${targetData.value}, Red=${targetData.isRed}`);
                    
                    const colorMatch = targetData.isRed !== movingData.isRed;
                    const valueMatch = targetData.value === movingData.value + 1;

                    if (colorMatch && valueMatch) {
                        console.log(`[CardLogic]      ✅ MATCH! Opposite Color & Value - 1.`);
                        console.log(`[CardLogic] ✅ Valid Stack: ${movingData.node.name} -> ${bottomTarget.name} (${target.node.name})`);
                        this.executeStackMove(sequence, target);
                        return true;
                    } else {
                        const reason = !colorMatch ? "SAME COLOR" : "WRONG VALUE";
                        console.log(`[CardLogic]      ❌ MISMATCH: ${reason}`);
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
                        cardNode.setParent(target.node);
                        cardNode.setPosition(finalLocalPositions[index]);
                        cardNode.setWorldScale(startWorldScales[index]); 

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

        console.log(`[CardLogic] ❌ Showing Error Feedback at: (${localPos.x.toFixed(2)}, ${localPos.y.toFixed(2)})`);

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