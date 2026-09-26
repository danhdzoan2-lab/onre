/* One front-to-personal position model for book tables and position alarms. */
'use strict';
function bookPositionLayout(groups,isPersonal) {
  let cutoff=-1;
  groups.forEach((group,index)=>{if(group.rows.some(({order})=>isPersonal(order)))cutoff=index;});
  const positions=new Map();
  const frontRows=cutoff<0?[]:groups.slice(0,cutoff+1).flatMap(group=>group.rows);
  const frontTotal=frontRows.length;
  const startApy=cutoff<0?null:groups[0].apy,endApy=cutoff<0?null:groups[cutoff].apy;
  frontRows.forEach(({order},index)=>positions.set(order,{index:index+1,total:frontTotal,apy:endApy,startApy,endApy}));
  for(const group of groups.slice(cutoff+1))group.rows.forEach(({order},index)=>positions.set(order,{index:index+1,total:group.rows.length,apy:group.apy,startApy:group.apy,endApy:group.apy}));
  const focusedGroups=cutoff<0?[]:[{
    key:'front-to-personal',apy:endApy,startApy,endApy,rows:frontRows,
    total:groups.slice(0,cutoff+1).reduce((sum,group)=>sum+group.total,0),
    unknown:groups.slice(0,cutoff+1).some(group=>group.unknown),frontRange:true
  }];
  return {focusedGroups,positions,cutoff};
}
if(typeof module!=='undefined')module.exports={bookPositionLayout};
