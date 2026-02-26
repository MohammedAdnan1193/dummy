import { _decorator, Component, Node, Vec3, tween } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('PeriodicScaler')
export class PeriodicScaler extends Component {
    @property
    public targetUrl: string = "https://play.google.com/store/apps/details?id=nova.solitaire.patience.card.games.klondike.free"; 

    @property
    public targetScale: number = 1.1; // The size it grows to (1.1 = 110%)

    @property
    public duration: number = 0.8; // Time in seconds for one half of the pulse

    private _initialScale: Vec3 = new Vec3(1, 1, 1);

    onLoad() {
        // Store the original scale so we always return to it
        this._initialScale = this.node.getScale();
        // this.startPulsing();
        this.node.on(Node.EventType.TOUCH_START, this.onButtonClick, this);
    }
    private onButtonClick() {
        console.log(`[CTARedirect] Opening URL: ${this.targetUrl}`);
        
        // Open the URL in a new tab
        window.open(this.targetUrl, '_blank');
    }
    public startPulsing() {
        const bigScale = new Vec3(
            this._initialScale.x * this.targetScale,
            this._initialScale.y * this.targetScale,
            this._initialScale.z
        );

        // Create a looping tween
        tween(this.node)
            .repeatForever(
                tween()
                    .to(this.duration, { scale: bigScale }, { easing: 'sineInOut' })
                    .to(this.duration, { scale: this._initialScale }, { easing: 'sineInOut' })
            )
            .start();
    }

    /**
     * Call this to stop the animation if needed
     */
    public stopPulsing() {
        tween(this.node).stop();
    }
}