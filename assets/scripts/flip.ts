import { _decorator, Component, Node, Sprite, SpriteFrame, Vec3, tween, isValid } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CardFlipper')
export class CardFlipper extends Component {

    @property(SpriteFrame)
    public faceUpSprite: SpriteFrame = null!; 

    @property(SpriteFrame)
    public faceDownSprite: SpriteFrame = null!; 

    private _isFlipping: boolean = false;

    public get isFlipping(): boolean {
        return this._isFlipping;
    }

    onLoad() {
        console.log(`[CardFlipper] Initialized on node: ${this.node.name}`);
    }

    /**
     * Call this function to trigger the flip animation
     */
    public flipToFaceUp(targetSprite?: SpriteFrame) {
        console.log(`[CardFlipper] flipToFaceUp called on: ${this.node.name}`);

        if (this._isFlipping) {
            console.warn(`[CardFlipper] 🛑 Animation Blocked: ${this.node.name} is already flipping.`);
            return;
        }
        
        this._isFlipping = true;

        const sprite = this.getComponent(Sprite);
        if (!sprite) {
            console.error(`[CardFlipper] ❌ Abort: Missing Sprite component on node: ${this.node.name}`);
            this._isFlipping = false;
            return;
        }

        if (targetSprite) {
            console.log(`[CardFlipper] Dynamic Sprite assigned: ${targetSprite.name}`);
            this.faceUpSprite = targetSprite;
        }

        console.log(`[CardFlipper] Starting Tween Phase 1: Shrinking scale...`);

        tween(this.node)
            // Phase 1: Shrink to center
            .to(0.15, { scale: new Vec3(0, 1, 1) }, { easing: 'sineIn' })
            .call(() => {
                console.log(`[CardFlipper] Tween Midpoint: Swapping textures.`);
                
                if (this.faceUpSprite) {
                    sprite.spriteFrame = this.faceUpSprite;
                    
                    if (this.faceUpSprite.name) {
                        const oldName = this.node.name;
                        this.node.name = this.faceUpSprite.name;
                        console.log(`[CardFlipper] Identity changed: ${oldName} -> ${this.node.name}`);
                    }
                } else {
                    console.error(`[CardFlipper] ❌ Error: No faceUpSprite assigned for ${this.node.name}`);
                }
            })
            // Phase 2: Grow back
            .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .call(() => {
                this._isFlipping = false;
                console.log(`[CardFlipper] ✅ Flip Sequence Finished: ${this.node.name}`);
            })
            .start();
    }

    /**
     * Helper to reset the card to face down visually without animation
     */
    public setFaceDown() {
        console.log(`[CardFlipper] Hard reset to Face Down for node: ${this.node.name}`);
        const sprite = this.getComponent(Sprite);
        if (sprite && this.faceDownSprite) {
            sprite.spriteFrame = this.faceDownSprite;
            this.node.name = "faceDown";
            this.node.setScale(new Vec3(1, 1, 1)); // Reset scale in case it was stuck at 0
            this._isFlipping = false;
        } else {
            console.error(`[CardFlipper] setFaceDown failed: Sprite or faceDownSprite is null.`);
        }
    }
}