import { _decorator, Component, Node, UITransform, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('StackOutline')
export class StackOutline extends Component {

    @property({ type: Node, tooltip: "Drag the child Outline Sprite here" })
    public outlineNode: Node = null!; 

    // Constants 
    private readonly CARD_HEIGHT = 230;
    private readonly STACK_OFFSET = 77; 
    

    onLoad() {
        // Ensure it starts hidden
        if (this.outlineNode) {
            this.outlineNode.active = false;
        }
    }

    public show(firstCard: Node, numberOfCards: number) {
        if (!firstCard || !this.outlineNode) return;

        // 1. Activate the node
        this.outlineNode.active = true;

        // 2. Calculate Height required
        // Height = One Card + (Overlaps * (Cards - 1))
        const totalHeight = this.CARD_HEIGHT + ((numberOfCards - 1) * this.STACK_OFFSET);
        // const width =160

        // 3. Set Size (Modify the Sliced Sprite height)
        const ui = this.outlineNode.getComponent(UITransform);
        if (ui) {
            console.log(ui.width)
            ui.setContentSize(ui.width, totalHeight);
        }

        // 4. Match Scale
        // We ensure the outline matches the card's visual scale
        const cardScale = firstCard.getWorldScale();
        this.outlineNode.setWorldScale(cardScale);

        // 5. Position (Align Top Edge)
        // Important: Your Outline Sprite Anchor MUST be (0.5, 1.0) for this math to work.
        const cardWorldPos = firstCard.getWorldPosition();
        
        // Calculate offset to move the anchor to the top edge of the card
        const halfHeightWorld = (this.CARD_HEIGHT * 0.5) * cardScale.y;

        this.outlineNode.setWorldPosition(new Vec3(
            cardWorldPos.x,
            cardWorldPos.y + halfHeightWorld,
            cardWorldPos.z
        ));
    }

    public clear() {
        if (this.outlineNode) {
            this.outlineNode.active = false;
        }
    }
}