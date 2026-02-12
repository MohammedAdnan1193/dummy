import { _decorator, Component, Node, Vec3, tween, UIOpacity, isValid } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('GameManager')
export class GameManager extends Component {

    @property(Node)
    public introNode: Node = null!;

    @property(Node)
    public mainNode: Node = null!;

    @property(Node)
    public mainLabel: Node = null!;

    @property({ tooltip: "Total moves required to show CTA" })
    public stepsToCTA: number = 3;

    @property({ type: [Node], tooltip: "Assign the specific holders that MUST be clicked to advance each guide step" })
    public progressionNodes: Node[] = [];

    @property({ type: [Node], tooltip: "Assign the specific Glow nodes for each step" })
    public glowNodes: Node[] = [];

    @property({ type: [Node], tooltip: "Assign the specific hand nodes for each step" })
    public handNodes: Node[] = [];

    @property(Node)
    public ctaScreen: Node = null!;

    private _currentStep: number = 0;
    
    @property(Node)
    public globalOverlay: Node = null!;

    onLoad() {
        // 1. Initial State Setup
        if (this.ctaScreen) {
            this.ctaScreen.active = false;
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

        // Show first guide step immediately
        this.toggleGuide(0, true, true); 
    }

    /**
     * Called by CardLogic. 
     * Progresses the tutorial ONLY if the clickedNode matches the progressionNode for the current step.
     */
    public addValidMove(clickedNode: Node) {
        const expectedNode = this.progressionNodes[this._currentStep];

        if (clickedNode === expectedNode) {
            // PROGRESSION MOVE: Advance the tutorial
            this.toggleGuide(this._currentStep, false);
            this._currentStep++;
            
            if (this._currentStep >= this.stepsToCTA) {
                this.showCTA();
            } else {
                const nextIndex = this._currentStep;
                this.unschedule(this.showDelayedGuide);
                this.scheduleOnce(() => this.showDelayedGuide(nextIndex), 1.2);
            }
        } else {
            // FREESTYLE MOVE: Hand stays/re-shines for the same step
            console.log("[GameManager] Valid move, but not the tutorial path.");
            this.toggleGuide(this._currentStep, false);
            this.unschedule(this.showDelayedGuide);
            this.scheduleOnce(() => this.showDelayedGuide(this._currentStep), 0.5);
        }
    }

    private showDelayedGuide(index: number) {
        if (index === this._currentStep && index < this.stepsToCTA) {
            this.toggleGuide(index, true, false);
        }
    }

    private toggleGuide(index: number, show: boolean, isInitial: boolean = false) {
        const glow = this.glowNodes[index];
        const hand = this.handNodes[index];

        if (show) {
            if (glow) { glow.active = true; this.fadeInAndStartGlow(glow, isInitial); }
            if (hand) { hand.active = true; this.fadeInHand(hand, isInitial); }
        } else {
            if (glow) { glow.active = false; }
            if (hand) { hand.active = false; }
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
            tween(op).to(0.4, { opacity: 100 }).call(() => this.startGlowLoop(op)).start();
        }
    }

    private startGlowLoop(op: UIOpacity) {
        tween(op).repeatForever(
            tween().to(0.5, { opacity: 255 }, { easing: 'sineInOut' }).to(0.5, { opacity: 100 }, { easing: 'sineInOut' })
        ).start();
    }

    private fadeInHand(node: Node, instant: boolean) {
        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        tween(op).stop();
        if (instant) { op.opacity = 255; } 
        else { op.opacity = 0; tween(op).to(0.4, { opacity: 255 }).start(); }
    }

    private hideAllGuides() {
        this.glowNodes.forEach(n => { if (n) n.active = false; });
        this.handNodes.forEach(n => { if (n) n.active = false; });
    }

    private showCTA() {
        if (!this.ctaScreen || this.ctaScreen.active) return;
        
        if (this.mainLabel) this.mainLabel.active = false;

        this.ctaScreen.active = true;
        const op = this.ctaScreen.getComponent(UIOpacity)!;
        op.opacity = 0;
        this.ctaScreen.setScale(new Vec3(0, 0, 1));

        tween(op).to(0.3, { opacity: 255 }).start();

        // Pop Animation
        tween(this.ctaScreen)
            .to(0.5, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
            .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .call(() => this.playCTAPulse())
            .start();
    }

    private playCTAPulse() {
        if (!isValid(this.ctaScreen)) return;
        tween(this.ctaScreen).repeatForever(
            tween().to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' }).to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
        ).start();
    }
}