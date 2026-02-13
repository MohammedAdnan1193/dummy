import { _decorator, Component, Node, Vec3, UITransform, tween, isValid, SpriteFrame, Sprite, UIOpacity, EventTouch, Layout, AudioSource, AudioClip } from 'cc';
import { CardFlipper } from './flip'; 
import { GameManager } from './GameManager'; 

const { ccclass, property } = _decorator;

export interface CardData {
    value: number;
    suit: number;
    isRed: boolean;
    node: Node;
}

@ccclass('CardLogic')
export class CardLogic extends Component {

    @property(Node)
    public placeholderNode: Node = null!;

    @property(SpriteFrame)
    public wrongClickSprite: SpriteFrame = null!;

    // Effects Assets
    @property(SpriteFrame)
    public ringSprite: SpriteFrame = null!;

    @property(SpriteFrame)
    public starSprite: SpriteFrame = null!;

    // SOUND PROPERTIES
    @property(AudioClip)
    public successSound: AudioClip = null!;

    @property(AudioClip)
    public errorSound: AudioClip = null!;

    @property(GameManager)
    public gameManager: GameManager = null!;

    private _audioSource: AudioSource = null!;

    onLoad() {
        console.log(`[CardLogic] Initializing holder: ${this.node.name}`);
        this._audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this.node.on(Node.EventType.TOUCH_START, this.onHolderClicked, this);
        this.updatePlaceholderVisibility();
    }

    /**
     * EXTRACTS DATA FROM CARD NAME (e.g., "card045")
     * Returns null if the node is not a valid game card.
     */
    getCardData(cardNode: Node): CardData | null {
        // 1. ROBUSTNESS CHECK: Immediately reject effects/feedback nodes
        if (!cardNode.active || 
            cardNode.name === "default" || 
            cardNode.name.includes("faceDown") ||
            cardNode.name === "WrongClickFeedback" || 
            !cardNode.name.startsWith("card")) {      
            return null;
        }
        
        const indexStr = cardNode.name.replace("card", "");
        const index = parseInt(indexStr);
        
        if (isNaN(index)) {
            console.warn(`[CardLogic] Failed to parse index from card name: ${cardNode.name}`);
            return null;
        }

        return {
            value: index % 13,
            suit: Math.floor(index / 13),
            isRed: (Math.floor(index / 13) === 1 || Math.floor(index / 13) === 2),
            node: cardNode
        };
    }

    onHolderClicked(event: EventTouch) {
        // console.log(`[CardLogic] Click detected on ${this.node.name}`);

        // 1. SAFETY CHECK: Ignore clicks if any card is currently flipping
        const activeFlippers = this.node.getComponentsInChildren(CardFlipper);
        const isBusy = activeFlippers.some(flipper => flipper.isFlipping);
        if (isBusy) {
            console.warn(`[CardLogic] 🛑 INPUT BLOCKED: Animation in progress.`);
            return; 
        }

        // 2. GET VALID CARDS: Filter out placeholders and effect nodes
        const faceUpCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            c.active &&
            c.name.startsWith("card") 
        );

        if (faceUpCards.length > 0) {
            // A. Check if the whole stack can move
            const baseCardNode = faceUpCards[0]; 
            const stackData = this.getCardData(baseCardNode);
            
            if (stackData && this.findValidMove(stackData, faceUpCards)) {
                return; // Move started successfully
            } 

            // B. Check if just the top card can move (split stack)
            if (faceUpCards.length > 1) {
                const lastCardNode = faceUpCards[faceUpCards.length - 1];
                const lastCardData = this.getCardData(lastCardNode);
                
                if (lastCardData && this.findValidMove(lastCardData, [lastCardNode])) {
                    return; // Move started successfully
                } 
            }
        }

        // 3. ERROR FEEDBACK
        console.log(`[CardLogic] ❌ Invalid Move on ${this.node.name}`);
        this.playSFX(this.errorSound);
        this.showWrongFeedback(event);
    }

    findValidMove(movingData: CardData, sequence: Node[]): boolean {
        const allHolders = this.node.parent!.getComponentsInChildren(CardLogic);
        
        for (const target of allHolders) {
            if (target === this) continue;
            
            // STRICT FILTER: Only look at real cards in the target column
            const targetChildren = target.node.children.filter(c => 
                c !== target.placeholderNode && 
                (c.name.startsWith("card") || c.name.includes("faceDown"))
            );

            const isTargetEmpty = targetChildren.length === 0;

            // RULE 1: King on Empty Column
            if (isTargetEmpty && movingData.value === 12) {
                console.log(`[CardLogic] ✅ Moving King to Empty: ${target.node.name}`);
                this.executeStackMove(sequence, target);
                return true;
            }

            // RULE 2: Standard Stacking (Opposite Color, Value - 1)
            if (!isTargetEmpty) {
                const bottomTarget = targetChildren[targetChildren.length - 1];
                const targetData = this.getCardData(bottomTarget); 
                
                if (targetData && targetData.isRed !== movingData.isRed && targetData.value === movingData.value + 1) {
                    console.log(`[CardLogic] ✅ Valid Stack: ${movingData.node.name} -> ${bottomTarget.name} (${target.node.name})`);
                    this.executeStackMove(sequence, target);
                    return true;
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
        
        // Notify Game Manager (for Undo/History)
        if (this.gameManager) this.gameManager.addValidMove(this.node); 
        
        console.log(`[CardLogic] >>> EXECUTE MOVE: ${nodesToMove.length} cards to ${target.node.name}`);

        // 1. SNAPSHOT ORIGINAL POSITIONS
        const startWorldPositions = nodesToMove.map(node => node.getWorldPosition().clone());
        const startWorldScales = nodesToMove.map(node => node.getWorldScale().clone());
        
        // 2. GHOSTING (The Calculation Phase)
        nodesToMove.forEach(cardNode => {
            const op = cardNode.getComponent(UIOpacity) || cardNode.addComponent(UIOpacity);
            op.opacity = 0; // Hide
            cardNode.setParent(target.node); // Move to target
        });

        // 3. FORCE LAYOUT & MATRIX UPDATES (Prevents "Pixel Drift")
        target.updatePlaceholderVisibility(); 
        if (targetLayout) targetLayout.updateLayout(); 

        target.node.updateWorldTransform(); // Force parent matrix update
        nodesToMove.forEach(node => node.updateWorldTransform()); // Force children matrix update

        const finalWorldPositions = nodesToMove.map(node => node.getWorldPosition().clone());
        const finalLocalPositions = nodesToMove.map(node => node.getPosition().clone());

        // 4. OVERLAY HANDOFF
        nodesToMove.forEach((cardNode, index) => {
            cardNode.setParent(overlay);
            cardNode.setWorldPosition(startWorldPositions[index]);
            cardNode.setWorldScale(startWorldScales[index]);
            cardNode.getComponent(UIOpacity)!.opacity = 255; 
        });

        // 5. ANIMATION
        nodesToMove.forEach((cardNode, index) => {
            
            // Calculate destination in Overlay's local space for smoother tweening
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
                        // Final Hand-off to Target Holder
                        cardNode.setParent(target.node);
                        cardNode.setPosition(finalLocalPositions[index]);
                        cardNode.setWorldScale(startWorldScales[index]); 

                        // Completion Logic (Run only on the last card)
                        if (index === nodesToMove.length - 1) {
                            console.log(`[CardLogic] <<< MOVE COMPLETE`);
                            this.playSuccessEffect(cardNode); 
                            this.checkAndFlipRevealedCard(); 
                            if (targetLayout) targetLayout.updateLayout();
                        }
                    }
                })
                .start();
        });

        this.updatePlaceholderVisibility();
    }

    private checkAndFlipRevealedCard() {
        // STRICT FILTER: Ignore placeholder AND feedback nodes
        const validCards = this.node.children.filter(c => 
            c !== this.placeholderNode && 
            (c.name.includes("faceDown") || c.name.startsWith("card"))
        );

        if (validCards.length > 0) {
            const lastCard = validCards[validCards.length - 1];
            if (lastCard.name.includes("faceDown")) {
                console.log(`[CardLogic] 🔀 Auto-flipping revealed card: ${lastCard.name}`);
                const flipper = lastCard.getComponent(CardFlipper);
                if (flipper) flipper.flipToFaceUp();
            }
        }
    }

    private showWrongFeedback(event: EventTouch) {
        const feedbackNode = new Node('WrongClickFeedback');
        const sprite = feedbackNode.addComponent(Sprite);
        const uiOpacity = feedbackNode.addComponent(UIOpacity);
        const transform = feedbackNode.addComponent(UITransform);

        sprite.spriteFrame = this.wrongClickSprite;
        transform.setContentSize(100, 100); 
        this.node.addChild(feedbackNode);

        const touchPos = event.getUILocation();
        const worldPos = new Vec3(touchPos.x, touchPos.y, 0);
        const localPos = this.node.getComponent(UITransform)!.convertToNodeSpaceAR(worldPos);
        feedbackNode.setPosition(localPos);

        tween(uiOpacity)
            .to(0.1, { opacity: 255 })
            .delay(0.4)
            .to(0.5, { opacity: 0 })
            .call(() => { 
                if (isValid(feedbackNode)) feedbackNode.destroy(); 
            })
            .start();
    }

    private playSFX(clip: AudioClip) {
        if (clip && this._audioSource) this._audioSource.playOneShot(clip, 1.0); 
    }

    private playSuccessEffect(targetNode: Node) {
        this.playSFX(this.successSound);

        // 1. Create Main Container at the target position
        const effectContainer = new Node('EffectContainer');
        this.node.parent?.addChild(effectContainer); 
        effectContainer.setWorldPosition(targetNode.getWorldPosition());

        // --- EFFECT 1: GROWING RING ---
        const ring = new Node('Ring');
        const ringSprite = ring.addComponent(Sprite);
        ringSprite.spriteFrame = this.ringSprite;
        const ringOpacity = ring.addComponent(UIOpacity);
        ringOpacity.opacity = 255;
        ring.addComponent(UITransform).setContentSize(200, 200); // Base size
        effectContainer.addChild(ring);

        // Reset Ring Scale
        ring.setScale(0, 0, 1);

        // Animate Ring: Grow fast, then fade out
        const ringDuration = 0.4;
        tween(ring)
            .to(ringDuration, { scale: new Vec3(2.0, 2.0, 1) }, { easing: 'backOut' })
            .start();

        tween(ringOpacity)
            .delay(ringDuration * 0.3)
            .to(ringDuration * 0.7, { opacity: 0 })
            .start();

        // --- EFFECT 2: SPRAYING PARTICLES (STARS) ---
        const particleCount = 30; // From your settings
        
        for (let i = 0; i < particleCount; i++) {
            const particle = new Node('Particle');
            const pSprite = particle.addComponent(Sprite);
            pSprite.spriteFrame = this.starSprite; // Using starSprite as the particle
            const pOpacity = particle.addComponent(UIOpacity);
            pOpacity.opacity = 255;
            particle.addComponent(UITransform).setContentSize(100, 100);
            effectContainer.addChild(particle);

            // --- Randomize Physics (Based on CardLandEffect logic) ---
            const angle = Math.random() * 360;
            const radian = angle * Math.PI / 180;
            
            // Speed: Base 300 +/- 150 var
            const speed = 300 + (Math.random() - 0.5) * 150; 
            
            // Lifetime: Base 0.6 +/- 0.3 var
            const lifetime = 0.6 + (Math.random() - 0.5) * 0.3; 

            // Initial Scale: 0.3 to 0.7
            const startScale = 0.3 + Math.random() * 0.4;
            particle.setScale(startScale, startScale, 1);

            // Calculate End Position
            const distance = speed * lifetime;
            const endX = Math.cos(radian) * distance;
            const endY = Math.sin(radian) * distance;

            // 1. Movement Tween
            tween(particle)
                .to(lifetime, { position: new Vec3(endX, endY, 0) }, { easing: 'sineOut' })
                .start();

            // 2. Opacity Tween (Fade out at end)
            tween(pOpacity)
                .to(lifetime * 0.7, { opacity: 255 })
                .to(lifetime * 0.3, { opacity: 0 })
                .start();

            // 3. Scale Tween (Shrink to tiny)
            tween(particle)
                .to(lifetime, { scale: new Vec3(0.05, 0.05, 1) }, { easing: 'sineIn' })
                .start();
        }

        // --- CLEANUP ---
        // Destroy the whole container after the longest animation finishes (approx 1 sec)
        tween(effectContainer.addComponent(UIOpacity))
            .delay(1.0)
            .call(() => { if (isValid(effectContainer)) effectContainer.destroy(); })
            .start();
    }

    public updatePlaceholderVisibility() {
        if (!this.placeholderNode) return;
        const hasCards = this.node.children.some(c => 
            c !== this.placeholderNode && 
            c.active && 
            (c.name.startsWith("card") || c.name.includes("faceDown"))
        );
        this.placeholderNode.active = !hasCards;
        const layout = this.getComponent(Layout);
        if (layout) layout.updateLayout();
    }
}