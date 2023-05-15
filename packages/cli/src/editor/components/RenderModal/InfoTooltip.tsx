import React, {useMemo} from 'react';
import {BACKGROUND, BORDER_COLOR, INPUT_BACKGROUND} from '../../helpers/colors';
import {VERTICAL_SCROLLBAR_CLASSNAME} from '../Menu/is-menu-item';
import {SHADOW_TOWARDS_BOTTOM, SHADOW_TOWARDS_TOP} from '../Menu/styles';

const arrow: React.CSSProperties = {
	height: 7,
	display: 'block',
	overflow: 'visible',
	marginLeft: 7,
};

const arrowUp: React.CSSProperties = {
	...arrow,
	transform: `translateY(1px)`,
};

const arrowDown: React.CSSProperties = {
	...arrow,
	marginTop: -0.5,
};

export const InfoTooltip: React.FC<{
	children: React.ReactNode;
	arrowDirection: 'up' | 'down';
}> = ({children, arrowDirection}) => {
	const container: React.CSSProperties = useMemo(() => {
		return {
			boxShadow:
				arrowDirection === 'down' ? SHADOW_TOWARDS_TOP : SHADOW_TOWARDS_BOTTOM,
			background: BACKGROUND,
			color: 'white',
			border: '0.5px solid ' + BORDER_COLOR,
			maxHeight: 200,
			overflow: 'auto',
			borderRadius: '4px',
		};
	}, [arrowDirection]);
	return (
		<div
			style={{
				display: 'flex',
				flexDirection: arrowDirection === 'up' ? 'column-reverse' : 'column',
				alignItems: 'flex-start',
			}}
		>
			<div style={container} className={VERTICAL_SCROLLBAR_CLASSNAME}>
				{children}
			</div>
			{arrowDirection === 'down' ? (
				<svg viewBox="0 0 14 7" style={arrowDown}>
					<path
						d={`M 14 0 L 7 7 L 0 0`}
						fill={INPUT_BACKGROUND}
						strokeLinecap="butt"
						stroke={BORDER_COLOR}
						strokeWidth={0.5}
					/>
				</svg>
			) : null}
			{arrowDirection === 'up' ? (
				<svg viewBox="0 0 14 7" style={arrowUp}>
					<path
						d={`M 0 7 L 7 0 L 14 7`}
						fill={INPUT_BACKGROUND}
						strokeLinecap="butt"
						stroke={BORDER_COLOR}
						strokeWidth={0.5}
					/>
				</svg>
			) : null}
		</div>
	);
};