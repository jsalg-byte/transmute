import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { SvgUri } from 'react-native-svg';

type AlchemySvgProps = {
  source: number;
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
};

/** Native implementation for bundled Commons SVG assets. */
export function AlchemySvg({ source, width, height, style }: AlchemySvgProps) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Asset.loadAsync(source).then(([asset]) => {
      if (active) setUri(asset.localUri ?? asset.uri);
    });

    return () => {
      active = false;
    };
  }, [source]);

  if (!uri) return <View style={[{ width, height }, style]} />;

  return <SvgUri width={width} height={height} uri={uri} style={style} />;
}
