import { _decorator, Component, Node, Vec3, tween } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('DiagonalMover')
export class DiagonalMover extends Component {

    @property(Vec3)
    public moveOffset: Vec3 = new Vec3(50, -50, 0); // Distance to travel diagonally

    @property
    public duration: number = 1.0; // Time for one direction

    private _startPos: Vec3 = new Vec3();

    onLoad() {
        // Capture the starting local position
        this._startPos = this.node.getPosition();
        this.startMoving();
    }

    private startMoving() {
        // Calculate the destination point relative to start
        const targetPos = new Vec3(
            this._startPos.x + this.moveOffset.x,
            this._startPos.y + this.moveOffset.y,
            this._startPos.z + this.moveOffset.z
        );

        // Infinite loop: Start -> Target -> Start
        tween(this.node)
            .repeatForever(
                tween()
                .to(this.duration, { position: this._startPos }, { easing: 'sineInOut' })
                    .to(this.duration, { position: targetPos }, { easing: 'sineInOut' })
            )
            .start();
    }

    public stopMoving() {
        tween(this.node).stop();
    }
}