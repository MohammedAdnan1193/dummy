import { _decorator, Component, Node, AudioClip, AudioSource } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('CTARedirect')
export class CTARedirect extends Component {

    @property
    public targetUrl: string = "https://play.google.com/store/apps/details?id=nova.solitaire.patience.card.games.klondike.free"; 
    
    @property({ type: AudioClip }) 
    public popup: AudioClip = null!;

    onLoad() {
        // Attach the click event to this node
        this.node.on(Node.EventType.TOUCH_START, this.onButtonClick, this);
        
        // Play the popup sound once when the node loads
        if (this.popup) {
            // Get the existing AudioSource or add a new one if it doesn't exist
            const audioSource = this.node.getComponent(AudioSource) || this.node.addComponent(AudioSource);
            audioSource.playOneShot(this.popup, 1.0); // 1.0 is the volume level (0.0 to 1.0)
        }
    }

    private onButtonClick() {
        console.log(`[CTARedirect] Opening URL: ${this.targetUrl}`);
        
        // Open the URL in a new tab
        window.open(this.targetUrl, '_blank');
    }
}