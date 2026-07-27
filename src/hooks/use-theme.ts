/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useTransmuteTheme } from '@/theme/transmute-theme';

export function useTheme() {
  const { mode } = useTransmuteTheme();
  return Colors[mode];
}
