import { _decorator, Component, Node, SpriteFrame, Sprite, UITransform, Vec3, tween, UIOpacity, isValid, AudioClip, AudioSource } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GridFeedback')
export class GridFeedback extends Component {
    @property(SpriteFrame)
    public wrongClickSprite: SpriteFrame = null!;

    @property(AudioClip)
    public errorSound: AudioClip = null!; // Drag your .wav or .mp3 here

    private _audioSource: AudioSource = null!;

    onLoad() {
        // Initialize the AudioSource component
        this._audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        
        // Listening for the click on the grid node
        this.node.on(Node.EventType.TOUCH_START, this.onGridClicked, this);
    }

    private onGridClicked(event: any) {
        const touchPos = event.getUILocation();
        const worldPos = new Vec3(touchPos.x, touchPos.y, 0);

        // 1. Play the sound immediately
        this.playErrorSFX();

        // 2. Show the visual X
        this.showWrongFeedback(worldPos);
    }

    private playErrorSFX() {
        if (this.errorSound && this._audioSource) {
            // playOneShot allows sounds to overlap if the user spams clicks
            this._audioSource.playOneShot(this.errorSound, 1.0);
        }
    }

    private showWrongFeedback(worldPos: Vec3) {
        const feedbackNode = new Node('WrongClickFeedback');
        
        const sprite = feedbackNode.addComponent(Sprite);
        const uiOpacity = feedbackNode.addComponent(UIOpacity);
        const transform = feedbackNode.addComponent(UITransform);

        sprite.spriteFrame = this.wrongClickSprite;
        transform.setContentSize(100, 100); 
        
        this.node.addChild(feedbackNode);
        feedbackNode.setWorldPosition(worldPos);

        // Animation: Fade in -> Wait -> Fade out -> Destroy
        tween(uiOpacity)
            .to(0.1, { opacity: 255 }) 
            .delay(0.4)                
            .to(0.5, { opacity: 0 })   
            .call(() => {
                if (isValid(feedbackNode)) feedbackNode.destroy();
            })
            .start();

        // Optional: Scale "Pop" effect
        feedbackNode.setScale(new Vec3(0.5, 0.5, 1));
        tween(feedbackNode)
            .to(0.15, { scale: new Vec3(1.2, 1.2, 1) }, { easing: 'backOut' })
            .to(0.1, { scale: new Vec3(1, 1, 1) })
            .start();
    }
}