import { _decorator, Component, Node, UIOpacity, tween } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GlowEffect')
export class GlowEffect extends Component {

    @property({ tooltip: "Minimum opacity (0-255)" })
    public minOpacity: number = 80;

    @property({ tooltip: "Maximum opacity (0-255)" })
    public maxOpacity: number = 255;

    @property({ tooltip: "Duration for one half of the glow cycle" })
    public duration: number = 1.0;

    private _uiOpacity: UIOpacity = null!;

    onLoad() {
        // 1. Ensure the UIOpacity component exists
        this._uiOpacity = this.getComponent(UIOpacity) || this.addComponent(UIOpacity);
        
        this.startGlow();
    }

    private startGlow() {
        // Set initial state
        this._uiOpacity.opacity = this.minOpacity;

        // 2. Create an infinite looping tween
        tween(this._uiOpacity)
            .repeatForever(
                tween()
                    .to(this.duration, { opacity: this.maxOpacity }, { easing: 'sineInOut' })
                    .to(this.duration, { opacity: this.minOpacity }, { easing: 'sineInOut' })
            )
            .start();
    }

    /**
     * Stop the animation and set to full opacity
     */
    public stopGlow() {
        tween(this._uiOpacity).stop();
        this._uiOpacity.opacity = 255;
    }
}