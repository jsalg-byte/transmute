import { StyleSheet, View } from "react-native";
import Svg, { ClipPath, Defs, Line, Path, Rect } from "react-native-svg";

type FastingHourglassProps = {
  progress: number | null;
  size?: number;
};

/** Original, data-driven hourglass. `null` represents an open-ended fast. */
export function FastingHourglass({ progress, size = 156 }: FastingHourglassProps) {
  const bounded = progress === null ? null : Math.max(0, Math.min(1, progress));
  const topSandHeight = bounded === null ? 29 : 58 * (1 - bounded);
  const bottomSandHeight = bounded === null ? 29 : 58 * bounded;

  return (
    <View accessible={false} style={[styles.wrap, { height: size * 1.28, width: size }]}>
      <Svg height="100%" viewBox="0 0 160 205" width="100%">
        <Defs>
          <ClipPath id="top-chamber"><Path d="M39 48H121L80 102Z" /></ClipPath>
          <ClipPath id="bottom-chamber"><Path d="M80 108L121 162H39Z" /></ClipPath>
        </Defs>
        <Rect fill="#101015" height="10" width="112" x="24" y="20" />
        <Rect fill="#101015" height="10" width="112" x="24" y="174" />
        <Path d="M38 30H122L80 104Z" fill="none" stroke="#101015" strokeWidth="5" />
        <Path d="M80 104L122 174H38Z" fill="none" stroke="#101015" strokeWidth="5" />
        <Line stroke="#101015" strokeWidth="5" x1="38" x2="38" y1="30" y2="174" />
        <Line stroke="#101015" strokeWidth="5" x1="122" x2="122" y1="30" y2="174" />
        <Rect clipPath="url(#top-chamber)" fill="#742F2A" height={topSandHeight} width="92" x="34" y={103 - topSandHeight} />
        <Rect clipPath="url(#bottom-chamber)" fill="#742F2A" height={bottomSandHeight} width="92" x="34" y={164 - bottomSandHeight} />
        {bounded !== null && bounded > 0 && bounded < 1 ? <Line stroke="#742F2A" strokeLinecap="round" strokeWidth="2.5" x1="80" x2="80" y1="98" y2="114" /> : null}
        <Rect fill="#F4EFE7" height="4" width="124" x="18" y="13" />
        <Rect fill="#F4EFE7" height="4" width="124" x="18" y="188" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
});
