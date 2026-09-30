namespace slot_core {
    /**
     * 單軸滾動的時間設定。
     *
     * targetStopTime 從 startRoll() 起算；結果提交時只反算一次需要保留的
     * 表演 Cell，不會每幀呼叫 Date.now() 或 getTime()。
     *
     * 原本定義在 ReelConfig.ts，與 Node／Prefab 等顯示設定放在同一檔。
     * 移植時拆成獨立檔案，讓停輪流程維持零引擎相依。
     */
    export interface ReelTimingConfig {
        /** 從本軸開始滾動到正式結果對齊的目標秒數。 */
        targetStopTime: number;

        /** 移動一個 1×1 Cell 所需秒數。 */
        moveInterval: number;
    }
}
