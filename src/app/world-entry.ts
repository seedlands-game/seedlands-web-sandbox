type Position = [number, number, number];

/** 开场只调整相机，不改变权威实体或存档位置。 */
export function orientNewPlayer(
  controller: { setView: (yaw: number, pitch: number) => void },
  server: { queryPois: (position: Position, radius: number, kind: 'camp') => { position: Position }[] },
  position: Position,
  isNew: boolean,
) {
  if (!isNew) return;
  const camp = server.queryPois(position, 40, 'camp')[0];
  if (!camp) return;
  const dx = camp.position[0] - position[0];
  const dz = camp.position[2] - position[2];
  controller.setView(
    (Math.atan2(-dx, -dz) * 180) / Math.PI,
    (Math.atan2(camp.position[1] + 1.2 - position[1], Math.hypot(dx, dz)) * 180) / Math.PI,
  );
}
