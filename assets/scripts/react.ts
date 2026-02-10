import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CTARedirect')
export class CTARedirect extends Component {

    @property
    public targetUrl: string = "https://www.google.com"; // Set your dummy website here

    onLoad() {
        // Attach the click event to this node
        this.node.on(Node.EventType.TOUCH_START, this.onButtonClick, this);
    }

    private onButtonClick() {
        console.log(`[CTARedirect] Opening URL: ${this.targetUrl}`);
        
        // Open the URL in a new tab
        window.open(this.targetUrl, '_blank');
    }
}