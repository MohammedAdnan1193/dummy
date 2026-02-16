import { _decorator, Component, Node, Vec3, tween, UIOpacity, isValid, AudioSource, AudioClip } from 'cc';
// ❌ Circular dependency fixed: No CardLogic import needed here

const { ccclass, property } = _decorator;

/**
 * GameManager handles the high-level game state, 
 * including the intro sequence, tutorial progression, CTA triggers,
 * and looping background music.
 */
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

    @property({ type: [Node], tooltip: "The specific holders that MUST be clicked to advance" })
    public progressionNodes: Node[] = [];

    @property({ type: [Node], tooltip: "Glow nodes for each step" })
    public glowNodes: Node[] = [];

    @property({ type: [Node], tooltip: "Hand nodes for each step" })
    public handNodes: Node[] = [];

    @property(Node)
    public ctaScreen: Node = null!;

    @property(Node)
    public globalOverlay: Node = null!;

    @property({ type: AudioClip, tooltip: "Background music track" })
    public bgmClip: AudioClip = null!;

    // --- CENTRALIZED HOLDER REFERENCES (Using Node to avoid Circular Dependency) ---
    @property({ type: [Node], tooltip: "Drag your 7 Tableau holder nodes here" })
    public tableauNodes: Node[] = [];

    @property({ type: [Node], tooltip: "Drag your 4 Foundation holder nodes here" })
    public foundationNodes: Node[] = [];

    @property({ type: Node, tooltip: "The face-down draw deck" })
    public stockNode: Node = null!;

    @property({ type: Node, tooltip: "The face-up playable discarded cards" })
    public wasteNode: Node = null!;
    // -----------------------------------------------------------------------------

    private _currentStep: number = 0;
    private _audioSource: AudioSource = null!;
    private _gameWon: boolean = false;

    onLoad() {
        console.log("[GameManager] Initializing game state...");
        
        this.initBGM();
        this.setupInitialState();
        this.startSequence();
    }

    private initBGM() {
        if (!this.bgmClip) {
            console.warn("[GameManager] No BGM Clip assigned in the inspector.");
            return;
        }

        this._audioSource = this.node.getComponent(AudioSource) || this.node.addComponent(AudioSource);
        this._audioSource.clip = this.bgmClip;
        this._audioSource.loop = true;
        this._audioSource.playOnAwake = true;
        this._audioSource.volume = 0.5; 
        this._audioSource.play();
    }

    private ensureAudioPlays() {
        if (this._audioSource && !this._audioSource.playing) {
            this._audioSource.play();
            console.log("[GameManager] Audio playback resumed via user interaction.");
        }
    }

    private setupInitialState() {
        if (this.ctaScreen) {
            this.ctaScreen.active = false;
            if (!this.ctaScreen.getComponent(UIOpacity)) this.ctaScreen.addComponent(UIOpacity);
        }

        if (this.mainNode) {
            this.mainNode.active = false; 
        }

        this.hideAllGuides();
    }

    private startSequence() {
        if (this.introNode) {
            console.log("[GameManager] Starting Intro Sequence.");
            this.introNode.active = true;
            this.scheduleOnce(() => this.fadeOutIntro(), 1.0);
        } else {
            console.log("[GameManager] No Intro Node assigned. Jumping to Game Logic.");
            this.startGameLogic();
        }
    }

    private fadeOutIntro() {
        console.log("[GameManager] Fading out Intro.");
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
        console.log("[GameManager] Game Logic Started.");
        if (this.mainNode) {
            this.mainNode.active = true;
            const mainOp = this.mainNode.getComponent(UIOpacity) || this.mainNode.addComponent(UIOpacity);
            mainOp.opacity = 0;
            tween(mainOp).to(0.3, { opacity: 255 }).start();
        }

        this.toggleGuide(0, true, true); 
    }

    /**
     * Triggered by CardLogic when a valid move occurs.
     */
    public addValidMove(clickedNode: Node) {
        this.ensureAudioPlays();

        // 1. Check for Win Condition (All cards in foundations)
        this.checkWinCondition();

        // 2. Handle Tutorial Progression
        const expectedNode = this.progressionNodes[this._currentStep];

        if (clickedNode === expectedNode) {
            console.log(`[GameManager] ✅ PROGRESSION MOVE: Correct node (${clickedNode.name}) clicked at step ${this._currentStep}.`);
            
            this.toggleGuide(this._currentStep, false);
            this._currentStep++;
            
            if (this._currentStep >= this.stepsToCTA) {
                console.log("[GameManager] Tutorial complete. Triggering CTA.");
                this.showCTA();
            } else {
                this.unschedule(this.showDelayedGuide);
                const nextIndex = this._currentStep;
                this.scheduleOnce(() => this.showDelayedGuide(nextIndex), 1.2);
            }
        } else {
            console.log(`[GameManager] ℹ️ FREESTYLE MOVE: Valid move on ${clickedNode.name}, but tutorial expects ${expectedNode?.name}.`);
            
            this.toggleGuide(this._currentStep, false);
            this.unschedule(this.showDelayedGuide);
            this.scheduleOnce(() => this.showDelayedGuide(this._currentStep), 0.5);
        }
    }

    /**
     * Checks if all 4 foundations are full (13 cards each = 52 total).
     */
    private checkWinCondition() {
        if (this._gameWon) return;

        let totalCardsInFoundation = 0;
        
        for (const foundation of this.foundationNodes) {
            // Count cards that aren't placeholders or effects
            const count = foundation.children.filter(c => c.name.startsWith("card")).length;
            totalCardsInFoundation += count;
        }

        // 52 cards means the game is beaten
        if (totalCardsInFoundation >= 52) {
            console.log("[GameManager] 🏆 WIN CONDITION MET! All 52 cards collected.");
            this._gameWon = true;
            this.hideAllGuides(); // Clear tutorial if still active
            this.scheduleOnce(() => this.showCTA(), 0.5); // Show end screen
        }
    }

    private showDelayedGuide(index: number) {
        if (index === this._currentStep && index < this.stepsToCTA) {
            console.log(`[GameManager] Showing delayed guide for step: ${index}`);
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
            tween()
                .to(0.5, { opacity: 255 }, { easing: 'sineInOut' })
                .to(0.5, { opacity: 100 }, { easing: 'sineInOut' })
        ).start();
    }

    private fadeInHand(node: Node, instant: boolean) {
        const op = node.getComponent(UIOpacity) || node.addComponent(UIOpacity);
        tween(op).stop();
        if (instant) { 
            op.opacity = 255; 
        } else { 
            op.opacity = 0; 
            tween(op).to(0.4, { opacity: 255 }).start(); 
        }
    }

    private hideAllGuides() {
        console.log("[GameManager] Hiding all tutorial guides.");
        this.glowNodes.forEach(n => { if (n) n.active = false; });
        this.handNodes.forEach(n => { if (n) n.active = false; });
    }

    private showCTA() {
        if (!this.ctaScreen || this.ctaScreen.active) return;
        
        console.log("[GameManager] Displaying CTA Screen.");
        if (this.mainLabel) this.mainLabel.active = false;

        this.ctaScreen.active = true;
        const op = this.ctaScreen.getComponent(UIOpacity)!;
        op.opacity = 0;
        this.ctaScreen.setScale(new Vec3(0, 0, 1));

        tween(op).to(0.3, { opacity: 255 }).start();

        tween(this.ctaScreen)
            .to(0.5, { scale: new Vec3(1.15, 1.15, 1) }, { easing: 'backOut' })
            .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
            .call(() => {
                console.log("[GameManager] CTA Pop Animation complete. Starting pulse.");
                this.playCTAPulse();
            })
            .start();
    }

    private playCTAPulse() {
        if (!isValid(this.ctaScreen)) return;
        tween(this.ctaScreen).repeatForever(
            tween()
                .to(0.8, { scale: new Vec3(1.05, 1.05, 1) }, { easing: 'sineInOut' })
                .to(0.8, { scale: new Vec3(1, 1, 1) }, { easing: 'sineInOut' })
        ).start();
    }
}