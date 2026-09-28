/**
 * BaseDropSlotMachine 的設定。
 *
 * 軸間隔照 v3 `UniDropReelView`：掉出用 `startSpaceTime`、掉入用
 * `stopDropSpaceTime`，Turbo 時不等；補牌全軸同時開始。
 */
export interface DropSlotMachineConfig {
    /**
     * `init()` 是否把掉落軸收成自己的子項；預設 true。
     *
     * 掉落軸內嵌在外層滾輪的空殼裡時設成 false —— 掉落軸留在原本的父層，
     * 機台只管時序（Drop-Module-Readiness Q11，暫定）。
     */
    readonly adoptReels?: boolean;

    /** 掉出時，相鄰兩軸開始的間隔秒數；預設 0。 */
    readonly dropOutIntervalSeconds?: number;

    /** 掉入時，相鄰兩軸開始的間隔秒數；預設 0。 */
    readonly dropInIntervalSeconds?: number;
}
