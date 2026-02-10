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
        this._audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this.node.on(Node.EventType.TOUCH_START, this.onHolderClicked, this);
        this.updatePlaceholderVisibility();
    }

    getCardData(cardNode: Node): CardData | null {
        if (!cardNode.active || cardNode.name === "default" || cardNode.name.includes("faceDown")) return null;
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

    onHolderClicked(event: EventTouch) {
        const faceUpCards = this.node.children.filter(c => 
            c !== this.placeholderNode && !c.name.includes("faceDown") && c.active
        );

        if (faceUpCards.length > 0) {
            const baseCardNode = faceUpCards[0]; 
            const stackData = this.getCardData(baseCardNode);
            if (stackData && this.findValidMove(stackData, faceUpCards)) return; 

            if (faceUpCards.length > 1) {
                const lastCardNode = faceUpCards[faceUpCards.length - 1];
                const lastCardData = this.getCardData(lastCardNode);
                if (lastCardData && this.findValidMove(lastCardData, [lastCardNode])) return; 
            }
        }

        this.playSFX(this.errorSound);
        this.showWrongFeedback(event);
    }

    findValidMove(movingData: CardData, sequence: Node[]): boolean {
        const allHolders = this.node.parent!.getComponentsInChildren(CardLogic);
        for (const target of allHolders) {
            if (target === this) continue;
            const targetChildren = target.node.children.filter(c => c !== target.placeholderNode);
            const isTargetEmpty = targetChildren.length === 0;

            if (isTargetEmpty && movingData.value === 12) {
                this.executeStackMove(sequence, target);
                return true;
            }

            if (!isTargetEmpty) {
                const bottomTarget = targetChildren[targetChildren.length - 1];
                const targetData = this.getCardData(bottomTarget);
                if (targetData && targetData.isRed !== movingData.isRed && targetData.value === movingData.value + 1) {
                    this.executeStackMove(sequence, target);
                    return true;
                }
            }
        }
        return false;
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

        tween(uiOpacity).to(0.1, { opacity: 255 }).delay(0.4).to(0.5, { opacity: 0 }).call(() => { if (isValid(feedbackNode)) feedbackNode.destroy(); }).start();
    }

    executeStackMove(nodesToMove: Node[], target: CardLogic) {
        // Success sound removed from here to trigger later with animations
        const targetLayout = target.getComponent(Layout);
        const startWorldPositions = nodesToMove.map(node => node.getWorldPosition());
        
        if (this.gameManager) {
            this.gameManager.addValidMove();
        }

        nodesToMove.forEach(cardNode => { cardNode.setParent(target.node); });
        if (targetLayout) targetLayout.updateLayout();

        nodesToMove.forEach((cardNode, index) => {
            const targetLocalPos = cardNode.getPosition();
            cardNode.setWorldPosition(startWorldPositions[index]);

            tween(cardNode)
                .to(0.5 + (index * 0.05), { position: targetLocalPos }, { 
                    easing: 'sineOut',
                    onComplete: () => {
                        if (index === nodesToMove.length - 1) {
                            if (targetLayout) targetLayout.updateLayout();
                            this.playSuccessEffect(cardNode); 
                            this.checkAndFlipRevealedCard(); 
                        }
                    }
                })
                .start();
        });

        this.updatePlaceholderVisibility();
        target.updatePlaceholderVisibility();
    }

    private playSFX(clip: AudioClip) {
        if (clip && this._audioSource) {
            this._audioSource.playOneShot(clip, 1.0); 
        }
    }

    private playSuccessEffect(targetNode: Node) {
        // --- TRIGGER SUCCESS SOUND HERE ---
        this.playSFX(this.successSound);

        const effectContainer = new Node('EffectContainer');
        this.node.parent?.addChild(effectContainer);
        effectContainer.setWorldPosition(targetNode.getWorldPosition());

        const ring = new Node('Ring');
        const ringSprite = ring.addComponent(Sprite);
        ringSprite.spriteFrame = this.ringSprite;
        ring.addComponent(UIOpacity).opacity = 255;
        ring.addComponent(UITransform).setContentSize(150, 150);
        effectContainer.addChild(ring);

        for (let i = 0; i < 30; i++) {
            const star = new Node('Star');
            const starSprite = star.addComponent(Sprite);
            starSprite.spriteFrame = this.starSprite;
            star.addComponent(UIOpacity).opacity = 255;
            star.addComponent(UITransform).setContentSize(40, 40);
            
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 50;
            star.setPosition(new Vec3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
            effectContainer.addChild(star);
        }

        effectContainer.setScale(new Vec3(0.5, 0.5, 1));
        
        tween(effectContainer)
            .to(0.5, { scale: new Vec3(4.5, 4.5, 1) }, { easing: 'sineOut' })
            .start();

        const opacityComp = effectContainer.addComponent(UIOpacity);
        tween(opacityComp)
            .to(0.5, { opacity: 0 }, { easing: 'sineIn' })
            .call(() => { if (isValid(effectContainer)) effectContainer.destroy(); })
            .start();
    }

    private checkAndFlipRevealedCard() {
        const remaining = this.node.children.filter(c => c !== this.placeholderNode);
        if (remaining.length > 0) {
            const lastCard = remaining[remaining.length - 1];
            if (lastCard.name.includes("faceDown")) {
                const flipper = lastCard.getComponent(CardFlipper);
                if (flipper) flipper.flipToFaceUp();
            }
        }
    }

    public updatePlaceholderVisibility() {
        if (!this.placeholderNode) return;
        const hasCards = this.node.children.some(c => c !== this.placeholderNode && c.active);
        this.placeholderNode.active = !hasCards;
        const layout = this.getComponent(Layout);
        if (layout) layout.updateLayout();
    }
}