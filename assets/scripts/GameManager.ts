import { _decorator, Component, Node, Vec3, tween, UIOpacity, isValid } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {

    @property(Node)
    public introNode: Node = null!; // The 1-second intro screen

    @property(Node)
    public mainNode: Node = null!;  // Container for the game board

    @property(Node)
    public mainLabel: Node = null!; // Label inside mainNode to be disabled on CTA

    @property({ tooltip: "Total moves required to show CTA" })
    public stepsToCTA: number = 3;

    @property({ type: [Node], tooltip: "Assign the specific Glow nodes for each step" })
    public glowNodes: Node[] = [];

    @property({ type: [Node], tooltip: "Assign the specific hand nodes for each step" })
    public handNodes: Node[] = [];

    @property(Node)
    public ctaScreen: Node = null!; // The final conversion screen

    private _currentStep: number = 0;

    onLoad() {
        // 1. Initial State Setup
        if (this.ctaScreen) {
            this.ctaScreen.active = false;
            // Ensure CTA has UIOpacity for fading
            if (!this.ctaScreen.getComponent(UIOpacity)) this.ctaScreen.addComponent(UIOpacity);
        }

        if (this.mainNode) {
            this.mainNode.active = false; 
        }

        this.hideAllGuides();

        // 2. Intro Sequence
        if (this.introNode) {
            this.introNode.active = true;
            this.scheduleOnce(() => {
                this.fadeOutIntro();
            }, 1.0);
        } else {
            this.startGameLogic();
        }
    }

    private fadeOutIntro() {
        const op = this.introNode.getComponent(UIOpacity) || this.introNode.addComponent(UIOpacity);
        
        tween(op)
            .to(0.4, { opacity: 0 })
            .call(() => {
                this.introNode.active = false;
                this.startGameLogic();
            })
            .start();
    }

    private startGameLogic() {
        if (this.mainNode) {
            this.mainNode.active = true;
            const mainOp = this.mainNode.getComponent(UIOpacity) || this.mainNode.addComponent(UIOpacity);
            mainOp.opacity = 0;
            tween(mainOp).to(0.3, { opacity: 255 }).start();
        }

        // Show first guide immediately and instantly (no intro animation)
        this.toggleGuide(0, true, true); 
    }

    /**
     * Logic-First: Called by CardLogic immediately on valid move detection.
     * This is asynchronous to card animations.
     */
    public addValidMove() {
        // 1. Hide current guide indicators immediately
        this.toggleGuide(this._currentStep, false);

        this._currentStep++;
        
        // 2. Check for CTA trigger
        if (this._currentStep >= this.stepsToCTA) {
            this.showCTA();
        } else {
            // 3. Schedule next guide with a delay to allow cards to land
            const nextIndex = this._currentStep;
            this.unschedule(this.showDelayedGuide); // Clear any pending reveals
            this.scheduleOnce(() => this.showDelayedGuide(nextIndex), 1.2);
        }
    }

    private showDelayedGuide(index: number) {
        // Guard: ensure we haven't clicked past this step already
        if (index === this._currentStep && index < this.stepsToCTA) {
            this.toggleGuide(index, true, false);
        }
    }

    private toggleGuide(index: number, show: boolean, isInitial: boolean = false) {
        const glow = this.glowNodes[index];
        const hand = this.handNodes[index];

        if (show) {
            if (glow) {
                glow.active = true;
                this.fadeInAndStartGlow(glow, isInitial);
            }
            if (hand) {
                hand.active = true;
                this.fadeInHand(hand, isInitial);
            }
        } else {
            if (glow) {
                const op = glow.getComponent(UIOpacity);
                if (op) tween(op).stop();
                glow.active = false;
            }
            if (hand) {
                const op = hand.getComponent(UIOpacity);
                if (op) tween(op).stop();
                hand.active = false;
            }
        }
    }

    private fadeInAndStartGlow(node: Node, instant: boolean) {
        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        tween(op).stop();

        if (instant) {
            op.opacity = 100;
            this.startGlowLoop(op);
        } else {
            op.opacity = 0;
            tween(op)
                .to(0.4, { opacity: 100 }, { easing: 'sineOut' })
                .call(() => this.startGlowLoop(op))
                .start();
        }
    }

    private startGlowLoop(op: UIOpacity) {
        tween(op)
            .repeatForever(
                tween()
                    .to(0.5, { opacity: 255 }, { easing: 'sineInOut' })
                    .to(0.5, { opacity: 100 }, { easing: 'sineInOut' })
            )
            .start();
    }

    private fadeInHand(node: Node, instant: boolean) {
        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        tween(op).stop();

        if (instant) {
            op.opacity = 255;
        } else {
            op.opacity = 0;
            tween(op).to(0.4, { opacity: 255 }, { easing: 'sineOut' }).start();
        }
    }

    private hideAllGuides() {
        this.glowNodes.forEach(n => { if (n) n.active = false; });
        this.handNodes.forEach(n => { if (n) n.active = false; });
    }

    private showCTA() {
        if (!this.ctaScreen || this.ctaScreen.active) return;
        
        // Disable gameplay label
        if (this.mainLabel) this.mainLabel.active = false;

        this.ctaScreen.active = true;
        const op = this.ctaScreen.getComponent(UIOpacity)!;
        
        op.opacity = 0;
        this.ctaScreen.setScale(new Vec3(0, 0, 1)); // Pop from 0

        // Fade in
        tween(op).to(0.3, { opacity: 255 }).start();

        // Pop Entrance Animation
        tween(this.ctaScreen)
            .to(0.5, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' }) // Overshoot
            .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })   // Settle
            // .call(() => {
            //     this.playCTAPulse(); // Start idle pulse
            // })
            .start();
    }

    private playCTAPulse() {
        if (!isValid(this.ctaScreen)) return;
        tween(this.ctaScreen)
            .repeatForever(
                tween()
                    .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                    .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            )
            .start();
    }
}