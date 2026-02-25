import { _decorator, Component, Node, Vec3, tween, Tween } from 'cc'; // Added Tween here
const { ccclass, property } = _decorator;

@ccclass('DiagonalMover')
export class DiagonalMover extends Component {

    @property({ type: Vec3, tooltip: "Spawn offset relative to the card" })
    public initialOffset: Vec3 = new Vec3(0, 50, 0); // Spawns 50px ABOVE the card

    @property({ type: Vec3, tooltip: "Distance and direction to animate" })
    public moveOffset: Vec3 = new Vec3(0, 50, 0); // Moves 50px DOWN (Only Y-axis)

    @property
    public duration: number = 0.5; 

    public startMovingAt(targetLocalPos: Vec3) {
        // PROPERLY stop any previously running tweens on this node
        Tween.stopAllByTarget(this.node);
        
        // 1. Calculate the spawn position by applying the initial Y offset
        const startPos = new Vec3(
            targetLocalPos.x + this.initialOffset.x,
            targetLocalPos.y + this.initialOffset.y,
            targetLocalPos.z + this.initialOffset.z
        );

        // Snap to the new starting position and ensure it is visible
        this.node.setPosition(startPos);
        console.log("new position ", startPos);
        this.node.active = true;

        // 2. Calculate where the hand should move TO
        const endPos = new Vec3(
            startPos.x + this.moveOffset.x,
            startPos.y + this.moveOffset.y,
            startPos.z + this.moveOffset.z
        );

        // 3. Animate: Start -> End -> Start
        tween(this.node)
            .repeatForever(
                tween()
                    // Hand moves IN toward the card (snappy deceleration)
                    .to(this.duration, { position: endPos }, { easing: 'quadOut' })
                    // Hand pulls BACK to the start (smooth acceleration)
                    .to(this.duration, { position: startPos }, { easing: 'quadIn' })
            )
            .start();
    }

    public stopMoving() {
        // PROPERLY kill the tween before hiding the node
        Tween.stopAllByTarget(this.node);
        this.node.active = false;
    }
}