import { _decorator, Component, view, screen, Vec3, UITransform, log } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('TopPinnedScaler')
export class TopPinnedScaler extends Component {

    @property
    designWidth: number = 1920; 

    @property
    designHeight: number = 1080;

    onLoad() {
        log(`[Scaler] Initializing... Design Resolution: ${this.designWidth}x${this.designHeight}`);
        
        const uiTransform = this.getComponent(UITransform);
        if (uiTransform) {
            uiTransform.setAnchorPoint(0.5, 1);
            log(`[Scaler] Anchor Point set to (0.5, 1) for top-center pinning.`);
        }

        view.on('canvas-resize', this.applyScale, this);
        this.applyScale();
    }

    applyScale() {
        const frameSize = screen.windowSize;
        const isPortrait = frameSize.height > frameSize.width;

        const scaleX = frameSize.width / this.designWidth;
        const scaleY = frameSize.height / this.designHeight;
        const finalScale = Math.min(scaleX, scaleY);

        this.node.setScale(new Vec3(finalScale, finalScale, 1));

        // Use console.info to bypass engine log level filters
        console.info(`--- [Scaler Update] ---`);
        console.info(`Orientation: ${isPortrait ? 'PORTRAIT' : 'LANDSCAPE'}`);
        console.info(`Window Size: ${frameSize.width.toFixed(0)}x${frameSize.height.toFixed(0)}`);
        console.info(`Final Chosen Scale: ${finalScale.toFixed(4)}`);
        console.info(`-----------------------`);
    }

    onDestroy() {
        view.off('canvas-resize', this.applyScale, this);
    }
}