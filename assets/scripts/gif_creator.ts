import { _decorator, Component, Sprite, SpriteFrame, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GifPlayer')
export class GifPlayer extends Component {

    // Array to hold all your GIF frames
    @property([SpriteFrame])
    frames: SpriteFrame[] = [];

    // Frames per second (default 10 = 0.1s per frame)
    @property
    frameRate: number = 10;

    // Should the animation loop?
    @property
    loop: boolean = true;

    // Play automatically on start?
    @property
    playOnLoad: boolean = true;

    // Private variables
    private sprite: Sprite = null!;
    private currentFrameIndex: number = 0;
    private timeAccumulator: number = 0;
    private isPlaying: boolean = false;

    onLoad() {
        // Get or add Sprite component
        this.sprite = this.getComponent(Sprite) || this.addComponent(Sprite);

        // Set initial frame if we have frames
        if (this.frames.length > 0) {
            this.sprite.spriteFrame = this.frames[0];
        }

        // Auto-play if enabled
        if (this.playOnLoad) {
            this.play();
        }
    }

    update(deltaTime: number) {
        if (!this.isPlaying || this.frames.length <= 1) return;

        // Calculate time per frame
        const frameTime = 1 / this.frameRate;
        this.timeAccumulator += deltaTime;

        // Check if it's time to switch to next frame
        if (this.timeAccumulator >= frameTime) {
            // Move to next frame
            this.currentFrameIndex++;

            // Handle looping or stopping
            if (this.currentFrameIndex >= this.frames.length) {
                if (this.loop) {
                    this.currentFrameIndex = 0; // Loop back to start
                } else {
                    this.currentFrameIndex = this.frames.length - 1; // Stay on last frame
                    this.stop(); // Stop animation
                    return;
                }
            }

            // Update the displayed frame
            this.sprite.spriteFrame = this.frames[this.currentFrameIndex];

            // Subtract frame time (not reset to 0 for more accurate timing)
            this.timeAccumulator -= frameTime;
        }
    }

    // Start playing the animation
    play() {
        this.isPlaying = true;
        this.timeAccumulator = 0;
        this.currentFrameIndex = 0;

        // Set initial frame
        if (this.frames.length > 0) {
            this.sprite.spriteFrame = this.frames[0];
        }
    }

    // Stop the animation
    stop() {
        this.isPlaying = false;
    }

    // Pause the animation
    pause() {
        this.isPlaying = false;
    }

    // Resume the animation
    resume() {
        this.isPlaying = true;
    }

    // Go to a specific frame
    gotoFrame(frameIndex: number) {
        if (frameIndex >= 0 && frameIndex < this.frames.length) {
            this.currentFrameIndex = frameIndex;
            this.sprite.spriteFrame = this.frames[frameIndex];
            this.timeAccumulator = 0;
        }
    }

    // Check if animation is playing
    isAnimationPlaying(): boolean {
        return this.isPlaying;
    }
}