declare module '@/components/alchemy-svg' {
  import type { ReactElement } from 'react';
  import type { StyleProp, ViewStyle } from 'react-native';

  export function AlchemySvg(props: {
    source: number;
    width: number;
    height: number;
    style?: StyleProp<ViewStyle>;
  }): ReactElement | null;
}
