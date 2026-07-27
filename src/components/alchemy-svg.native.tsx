import { Asset } from 'expo-asset';
import type { StyleProp, ViewStyle } from 'react-native';
import { SvgUri } from 'react-native-svg';

type AlchemySvgProps = {
  source: number;
  width: number;
  height: number;
  monochrome?: "light";
  style?: StyleProp<ViewStyle>;
};

/** Native implementation for bundled Commons SVG assets. */
export function AlchemySvg({ source, width, height, monochrome, style }: AlchemySvgProps) {
  const asset = Asset.fromModule(source);
  const uri = asset.localUri ?? asset.uri;

  return <SvgUri color={monochrome === "light" ? "#FFFFFF" : undefined} width={width} height={height} uri={uri} style={style} />;
}
