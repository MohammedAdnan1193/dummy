import { _decorator, Component, view, ResolutionPolicy, Node, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ResolutionManager')
export class ResolutionManager extends Component {

    @property(Node)
    portraitLogo: Node = null!; // Drag your Portrait Logo here

    @property(Node)
    landscapeLogo: Node = null!; // Drag your Landscape Logo here

    // You can add more groups if needed!
    @property(Node)
    portraitUI: Node = null!;   // e.g., A container with portrait-specific buttons
    
    @property(Node)
    landscapeUI: Node = null!;  // e.g., A container with landscape-specific buttons

    onLoad() {
        view.setResizeCallback(() => this.updateLayout());
        this.updateLayout();
    }

    updateLayout() {
        // 1. Get Screen Orientation
        const frameSize = view.getFrameSize();
        const isLandscape = frameSize.width > frameSize.height;

        // 2. Resolution Logic (From previous step)
        if (isLandscape) {
            view.setDesignResolutionSize(1440, 720, ResolutionPolicy.FIXED_HEIGHT);
        } else {
            view.setDesignResolutionSize(720, 1440, ResolutionPolicy.FIXED_WIDTH);
        }

        // 3. The Toggle Logic
        if (isLandscape) {
            // Enable Landscape elements
            if (this.landscapeLogo) this.landscapeLogo.active = true;
            if (this.landscapeUI) this.landscapeUI.active = true;

            // Disable Portrait elements
            if (this.portraitLogo) this.portraitLogo.active = false;
            if (this.portraitUI) this.portraitUI.active = false;

            console.log("Switched to Landscape UI");
        } else {
            // Enable Portrait elements
            if (this.portraitLogo) this.portraitLogo.active = true;
            if (this.portraitUI) this.portraitUI.active = true;

            // Disable Landscape elements
            if (this.landscapeLogo) this.landscapeLogo.active = false;
            if (this.landscapeUI) this.landscapeUI.active = false;

            console.log("Switched to Portrait UI");
        }
        
        // Force update widget positions
        this.node.getComponent(UITransform)?.setContentSize(view.getVisibleSize());
    }
}