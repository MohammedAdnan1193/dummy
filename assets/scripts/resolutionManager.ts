import { _decorator, Component, view, ResolutionPolicy, Node, UITransform } from 'cc';
import { GameManager } from './GameManager'; // 1. IMPORT GAMEMANAGER
const { ccclass, property } = _decorator;

@ccclass('ResolutionManager')
export class ResolutionManager extends Component {

    @property(Node)
    portraitLogo: Node = null!; 

    @property(Node)
    landscapeLogo: Node = null!; 

    @property(Node)
    portraitUI: Node = null!;   
    
    @property(Node)
    landscapeUI: Node = null!;  

    // 2. ADD PROPERTY TO CONNECT GAME MANAGER
    @property(GameManager)
    gameManager: GameManager = null!; 

    onLoad() {
        // Use an arrow function to keep 'this' context safe
        view.setResizeCallback(() => this.updateLayout());
        
        // Initial setup
        this.updateLayout();
    }

    updateLayout() {
        // --- EXISTING LOGIC ---
        const frameSize = view.getFrameSize();
        const isLandscape = frameSize.width > frameSize.height;

        if (isLandscape) {
            view.setDesignResolutionSize(1440, 720, ResolutionPolicy.FIXED_HEIGHT);
        } else {
            view.setDesignResolutionSize(720, 1440, ResolutionPolicy.FIXED_WIDTH);
        }

        if (isLandscape) {
            if (this.landscapeLogo) this.landscapeLogo.active = true;
            if (this.landscapeUI) this.landscapeUI.active = true;
            if (this.portraitLogo) this.portraitLogo.active = false;
            if (this.portraitUI) this.portraitUI.active = false;
            console.log("Switched to Landscape UI");
        } else {
            if (this.portraitLogo) this.portraitLogo.active = true;
            if (this.portraitUI) this.portraitUI.active = true;
            if (this.landscapeLogo) this.landscapeLogo.active = false;
            if (this.landscapeUI) this.landscapeUI.active = false;
            console.log("Switched to Portrait UI");
        }
        
        this.node.getComponent(UITransform)?.setContentSize(view.getVisibleSize());

        // --- 3. NEW LOGIC: REFRESH GAME MANAGER ---
        if (this.gameManager) {
            console.log("[ResolutionManager] Layout changed -> Resetting Guide Timer");
            // This clears the current hint arrow immediately and resets the 5s timer
            this.gameManager.resetIdleTimer();
        }
    }
}