import { _decorator, Component, Node, Sprite, SpriteFrame, Vec3, tween, isValid } from 'cc';
import { GameManager } from './GameManager'; 

const { ccclass, property } = _decorator;

@ccclass('CardFlipper')
export class CardFlipper extends Component {

    @property(SpriteFrame)
    public faceUpSprite: SpriteFrame = null!; 

    @property(SpriteFrame)
    public faceDownSprite: SpriteFrame = null!; 

    @property(GameManager)
    public gameManager: GameManager = null!;

    private _isFlipping: boolean = false;

    public get isFlipping(): boolean {
        return this._isFlipping;
    }

    onLoad() {
        // Auto-find GameManager if you forgot to drag it in
        if (!this.gameManager) {
            this.gameManager = this.node.scene.getComponentInChildren(GameManager);
        }
        console.log(`[CardFlipper] Initialized on node: ${this.node.name}`);
    }

    public flipToFaceUp(targetSprite?: SpriteFrame) {
        if (this._isFlipping) return;

        // 1. 🛑 CAPTURE STATE NOW (Before CardLogic renames it!)
        const wasFaceDown = this.node.name.includes("faceDown");
        console.log(`[CardFlipper] flip called on: ${this.node.name} | Is Hidden? ${wasFaceDown}`);

        this._isFlipping = true;
        const sprite = this.getComponent(Sprite);

        if (!sprite) {
            this._isFlipping = false;
            return;
        }

        if (targetSprite) {
            this.faceUpSprite = targetSprite;
        }

        tween(this.node)
            .to(0.15, { scale: new Vec3(0, 1, 1) }, { easing: 'sineIn' })
            .call(() => {
                if (this.faceUpSprite) {
                    sprite.spriteFrame = this.faceUpSprite;
                    
                    if (this.faceUpSprite.name) {
                        this.node.name = this.faceUpSprite.name;
                    }
                    
                    // 2. 📢 REPORT USING CAPTURED STATE
                    if (wasFaceDown) {
                        if (this.gameManager) {
                            console.log(`[CardFlipper] 📢 Reporting Reveal to GameManager`);
                            this.gameManager.onCardRevealed();
                        } else {
                            console.warn(`[CardFlipper] ⚠️ Card Revealed, but GameManager is missing!`);
                        }
                    }
                }
            })
            .to(0.15, { scale: new Vec3(1, 1, 1) }, { easing: 'sineOut' })
            .call(() => {
                this._isFlipping = false;
            })
            .start();
    }

    public setFaceDown() {
        const sprite = this.getComponent(Sprite);
        if (sprite && this.faceDownSprite) {
            sprite.spriteFrame = this.faceDownSprite;
            // Ensure we add the tag so it counts as hidden again if reset
            this.node.name = "faceDown"; 
            this.node.setScale(new Vec3(1, 1, 1)); 
            this._isFlipping = false;
        }
    }
}