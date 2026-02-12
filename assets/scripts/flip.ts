import { _decorator, Component, Node, Sprite, SpriteFrame, Vec3, tween, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CardFlipper')
export class CardFlipper extends Component {

    @property(SpriteFrame)
    public faceUpSprite: SpriteFrame = null!; // The specific cardXXX sprite

    @property(SpriteFrame)
    public faceDownSprite: SpriteFrame = null!; // Your back-of-card sprite

    // Internal flag to track animation state
    private _isFlipping: boolean = false;

    /**
     * PUBLIC GETTER
     * Allows other scripts (like CardLogic) to ask: "Are you busy flipping?"
     * Usage: if (cardFlipper.isFlipping) return;
     */
    public get isFlipping(): boolean {
        return this._isFlipping;
    }

    /**
     * Call this function to trigger the flip animation
     * @param targetSprite Optional: if you want to pass the new sprite dynamically
     */
    public flipToFaceUp(targetSprite?: SpriteFrame) {
        // Prevent double-flipping if already running
        if (this._isFlipping) return;
        
        this._isFlipping = true;

        const sprite = this.getComponent(Sprite);
        if (!sprite) {
            console.error("[CardFlipper] Missing Sprite component on node:", this.node.name);
            this._isFlipping = false;
            return;
        }

        if (targetSprite) {
            this.faceUpSprite = targetSprite;
        }

        // --- FLIP ANIMATION SEQUENCE ---
        // 1. Shrink X-scale to 0 (the 'disappearing' edge-on look)
        // 2. Swap the SpriteFrame while the card is 'invisible'
        // 3. Grow X-scale back to 1 (revealing the face)

        tween(this.node)
            .to(0.15, { scale: new Vec3(0, 1, 1) }, { easing: 'sineIn' })
            .call(() => {
                // Change the visual asset
                if (this.faceUpSprite) {
                    sprite.spriteFrame = this.faceUpSprite;
                    
                    // Change the node name so CardLogic can parse it (e.g., "card046")
                    if (this.faceUpSprite.name) {
                        this.node.name = this.faceUpSprite.name;
                    }
                }
            })
            .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .call(() => {
                this._isFlipping = false;
                console.log(`[CardFlipper] Flip complete: ${this.node.name}`);
            })
            .start();
    }

    /**
     * Helper to reset the card to face down visually without animation
     */
    public setFaceDown() {
        const sprite = this.getComponent(Sprite);
        if (sprite && this.faceDownSprite) {
            sprite.spriteFrame = this.faceDownSprite;
            this.node.name = "faceDown";
        }
    }
}