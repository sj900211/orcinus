import Svg, { Path } from 'react-native-svg'
import { colors } from '../theme/mobile-theme'

type Props = {
  size?: number
  color?: string
}

export function OrcaLogo({ size = 24, color = colors.textPrimary }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12">
      <Path
        fill="none"
        stroke={color}
        strokeWidth={0.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 7.668h4.715M4.82 7.18l3.336 3.332M7.668 6a1.667 1.667 0 1 0-3.336 0 1.667 1.667 0 1 0 3.336 0ZM11 6A5 5 0 1 0 1 6a5 5 0 0 0 10 0zm0 0"
      />
    </Svg>
  )
}
