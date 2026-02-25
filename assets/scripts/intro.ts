import { _decorator, Component, Node } from 'cc';
// Make sure to import your GameManager script
// import { GameManager } from './GameManager'; 

const { ccclass, property } = _decorator;

@ccclass('Intro')
export class NewComponent extends Component {
    // Optional: Expose GameManager to the Cocos Editor so you can drag-and-drop it
    // @property(GameManager)
    // gameManager: GameManager | null = null;

    private _hasTriggered: boolean = false;

    start() {
        // 1. Add the click event (TOUCH_END is standard for UI clicks in Cocos)
        this.node.on(Node.EventType.TOUCH_END, this.onClick, this);

        // 2. Schedule the auto-call if not clicked for 3 seconds
        this.scheduleOnce(this.autoCall, 3.0);
    }

    private onClick() {
        if (this._hasTriggered) return;

        // Cancel the 3-second timer since the user clicked
        this.unschedule(this.autoCall);
        
        this.triggerManager();
    }

    private autoCall() {
        if (this._hasTriggered) return;
        
        this.triggerManager();
    }

    private triggerManager() {
        this._hasTriggered = true;

        // 3. Call your GameManager here
        console.log("Calling GameManager!");
        // if (this.gameManager) {
        //     this.gameManager.yourMethodHere();
        // }

        // 4. Disable itself. 
        // Use `this.node.active = false` to hide/disable the whole node.
        // Use `this.enabled = false` if you only want to disable this specific script.
        this.node.active = false; 
        
    }

    protected onDestroy() {
        // Good practice: Always unregister events when the node is destroyed
        this.node.off(Node.EventType.TOUCH_END, this.onClick, this);
    }
}


