export function validTime(value) {
 return Number.isSafeInteger(value) && value > 0 && value <= 253402300799999;
}

// Earlier uploads stored the negative creation timestamp in sort_order.
// Do not invent a creation date for legacy rows that only have a manual rank.
export function initializeProjectTimes(db) {
 const update=db.prepare('UPDATE projects SET data=? WHERE id=?');
 db.exec('BEGIN IMMEDIATE');
 try {
  for(const row of db.prepare('SELECT id,data,sort_order FROM projects').all()) {
   const p=JSON.parse(row.data), before=JSON.stringify(p);
   if(!validTime(p.createdAt) && -row.sort_order>=946684800000 && -row.sort_order<=Date.now()) p.createdAt=-row.sort_order;
   if(p.shotAt===undefined) p.shotAt=validTime(p.createdAt)?p.createdAt:validTime(p.publishedAt)?p.publishedAt:null;
   if(p.updatedAt===undefined) p.updatedAt=validTime(p.createdAt)?Math.max(p.createdAt,p.publishedAt||0):p.publishedAt||null;
   if(JSON.stringify(p)!==before) update.run(JSON.stringify(p),row.id);
  }
  db.exec('COMMIT');
 } catch(error) {db.exec('ROLLBACK');throw error;}
}
