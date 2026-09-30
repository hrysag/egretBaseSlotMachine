namespace slot_core {
    /**
     * Reel 的軸向顯示效果設定。
     *
     * 同一份設定同時供啟動效果與停止效果使用；兩者的差別只在移出方向，
     * 由 BaseReel 依當前滾動方向決定正負號，不寫進設定本身。
     *
     * 效果只改變 Icon 的顯示偏移，不參與 Runtime 位置、正式結果對齊、
     * 資料消耗或目標停止時間的計算。
     */
    export interface ReelEffectConfig {
        /** 是否播放此效果。 */
        readonly enabled: boolean;

        /** 沿效果方向移出的距離，使用 Reel 軸向單位。 */
        readonly distance: number;

        /** 向外移出所需秒數。 */
        readonly outwardDuration: number;

        /** 回到原本軸線所需秒數。 */
        readonly returnDuration: number;

        /** 向外移出的 Easing；未設定時使用 CubicOut。 */
        readonly outwardEasing?: ReelEffectEasing;

        /** 回到原本軸線的 Easing；未設定時使用 Linear。 */
        readonly returnEasing?: ReelEffectEasing;
    }
}
