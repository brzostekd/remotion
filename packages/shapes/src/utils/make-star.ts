// Copied from https://stackblitz.com/edit/svg-star-generator?file=index.js

import type {ShapeInfo} from './shape-info';
import {star} from './star';

export type MakeStarProps = {
	width: number;
	height: number;
	points: number;
	innerRadius: number;
	outerRadius: number;
};

export const makeStar = ({
	width,
	height,
	points,
	innerRadius,
	outerRadius,
}: MakeStarProps): ShapeInfo => {
	const centerX = width;
	const centerY = height;

	const starPath = star({
		centerX,
		centerY,
		points,
		innerRadius,
		outerRadius,
	});

	return {
		path: starPath,
		width,
		height,
		transformOrigin: `${centerX} ${centerY}`,
	};
};
