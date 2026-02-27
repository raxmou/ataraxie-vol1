/**
 * @module ui/character-data
 * Character move sets and frame helpers. Pure data, no DOM.
 */

export const CHARACTER_MOVE_MAP = {
  demon: {
    idle: [
      "assets/characters/demon/idle/frame1.svg",
      "assets/characters/demon/idle/frame2.svg",
      "assets/characters/demon/idle/frame3.svg",
    ],
    stomp: [
      "assets/characters/demon/stomp/frame1.svg",
      "assets/characters/demon/stomp/frame2.svg",
      "assets/characters/demon/stomp/frame3.svg",
    ],
    armwave: [
      "assets/characters/demon/armwave/frame1.svg",
      "assets/characters/demon/armwave/frame2.svg",
      "assets/characters/demon/armwave/frame3.svg",
      "assets/characters/demon/armwave/frame4.svg",
      "assets/characters/demon/armwave/frame5.svg",
    ],
    turn: [
      "assets/characters/demon/turn/frame1.svg",
      "assets/characters/demon/turn/frame2.svg",
      "assets/characters/demon/turn/frame3.svg",
      "assets/characters/demon/turn/frame4.svg",
      "assets/characters/demon/turn/frame5.svg",
      "assets/characters/demon/turn/frame6.svg",
    ],
    hipshake: [
      "assets/characters/demon/hipshake/frame1.svg",
      "assets/characters/demon/hipshake/frame2.svg",
      "assets/characters/demon/hipshake/frame3.svg",
      "assets/characters/demon/hipshake/frame4.svg",
    ],
    jump: [
      "assets/characters/demon/jump/frame1.svg",
      "assets/characters/demon/jump/frame2.svg",
      "assets/characters/demon/jump/frame3.svg",
      "assets/characters/demon/jump/frame4.svg",
    ],
    headbang: [
      "assets/characters/demon/headbang/frame1.svg",
      "assets/characters/demon/headbang/frame2.svg",
      "assets/characters/demon/headbang/frame3.svg",
    ],
  },
  succube: {
    idle: [
      "assets/characters/succube/idle/frame1.svg",
      "assets/characters/succube/idle/frame2.svg",
      "assets/characters/succube/idle/frame3.svg",
    ],
    stomp: [
      "assets/characters/succube/stomp/frame1.svg",
      "assets/characters/succube/stomp/frame2.svg",
      "assets/characters/succube/stomp/frame3.svg",
    ],
    armwave: [
      "assets/characters/succube/armwave/frame1.svg",
      "assets/characters/succube/armwave/frame2.svg",
      "assets/characters/succube/armwave/frame3.svg",
      "assets/characters/succube/armwave/frame4.svg",
      "assets/characters/succube/armwave/frame5.svg",
    ],
    turn: [
      "assets/characters/succube/turn/frame1.svg",
      "assets/characters/succube/turn/frame2.svg",
      "assets/characters/succube/turn/frame3.svg",
      "assets/characters/succube/turn/frame4.svg",
      "assets/characters/succube/turn/frame5.svg",
      "assets/characters/succube/turn/frame6.svg",
    ],
    hipshake: [
      "assets/characters/succube/hipshake/frame1.svg",
      "assets/characters/succube/hipshake/frame2.svg",
      "assets/characters/succube/hipshake/frame3.svg",
      "assets/characters/succube/hipshake/frame4.svg",
    ],
    jump: [
      "assets/characters/succube/jump/frame1.svg",
      "assets/characters/succube/jump/frame2.svg",
      "assets/characters/succube/jump/frame3.svg",
      "assets/characters/succube/jump/frame4.svg",
    ],
    headbang: [
      "assets/characters/succube/headbang/frame1.svg",
      "assets/characters/succube/headbang/frame2.svg",
      "assets/characters/succube/headbang/frame3.svg",
    ],
  },
  gargoyle: {
    idle: [
      "assets/characters/gargoyle/idle/frame1.svg",
      "assets/characters/gargoyle/idle/frame2.svg",
      "assets/characters/gargoyle/idle/frame3.svg",
    ],
    stomp: [
      "assets/characters/gargoyle/stomp/frame1.svg",
      "assets/characters/gargoyle/stomp/frame2.svg",
      "assets/characters/gargoyle/stomp/frame3.svg",
    ],
    armwave: [
      "assets/characters/gargoyle/armwave/frame1.svg",
      "assets/characters/gargoyle/armwave/frame2.svg",
      "assets/characters/gargoyle/armwave/frame3.svg",
      "assets/characters/gargoyle/armwave/frame4.svg",
      "assets/characters/gargoyle/armwave/frame5.svg",
    ],
    turn: [
      "assets/characters/gargoyle/turn/frame1.svg",
      "assets/characters/gargoyle/turn/frame2.svg",
      "assets/characters/gargoyle/turn/frame3.svg",
      "assets/characters/gargoyle/turn/frame4.svg",
      "assets/characters/gargoyle/turn/frame5.svg",
      "assets/characters/gargoyle/turn/frame6.svg",
    ],
    hipshake: [
      "assets/characters/gargoyle/hipshake/frame1.svg",
      "assets/characters/gargoyle/hipshake/frame2.svg",
      "assets/characters/gargoyle/hipshake/frame3.svg",
      "assets/characters/gargoyle/hipshake/frame4.svg",
    ],
    jump: [
      "assets/characters/gargoyle/jump/frame1.svg",
      "assets/characters/gargoyle/jump/frame2.svg",
      "assets/characters/gargoyle/jump/frame3.svg",
      "assets/characters/gargoyle/jump/frame4.svg",
    ],
    headbang: [
      "assets/characters/gargoyle/headbang/frame1.svg",
      "assets/characters/gargoyle/headbang/frame2.svg",
      "assets/characters/gargoyle/headbang/frame3.svg",
    ],
  },
};

export const getCharacterFrame = (character, frameIndex = 0) => {
  const moveSet = CHARACTER_MOVE_MAP[character];
  if (!moveSet || !moveSet.idle) return "";
  return moveSet.idle[frameIndex] || moveSet.idle[0];
};
