import { AiController } from "../Ai-Controller.js";
import { AttackState } from "./States/Attack-State.js";
import { ChaseState } from "./States/Chase-State.js";
import { DodgeState } from "./States/Dodge-State.js";
import { IdleState } from "./States/Idle-state.js";
import { InvestigateState } from "./States/Investigate-state.js";
import { State } from "./States/State.js";
import { WanderState } from "./States/Wander-State.js";

export class StateMachine {
  player: AiController;
  states: { [key: string]: State };
  currentState: State;
  currentName = "chase";

  constructor(player: AiController) {
    this.player = player;
    this.states = {
      idle: new IdleState(player),
      chase: new ChaseState(player),
      investigate: new InvestigateState(player),
      wander: new WanderState(player),
      attack: new AttackState(player),
      dodge: new DodgeState(player),
    };

    this.currentState = this.states["idle"];
    this.currentState.onEnter();
  }

  switchState(state: string) {
    const next = this.states[state];
    if (!next) {
      console.warn(`StateMachine: unknown state "${state}"`);
      return;
    }
    if (this.currentState === next) return;
    this.currentState.onExit();
    this.currentState = next; // set BEFORE onEnter so nested switches work
    this.currentName = state;
    next.onEnter();
  }

  update(dt: number) {
    this.currentState.onUpdate(dt);
  }
}
