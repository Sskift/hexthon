// Rules are deliberately keyed by OP.GG id + key + description fragments.
// Source: data/seed/index.json; item facts: data/static/riot.json (Riot Data Dragon).
// A changed/missing description disables its rule. No conversion ratios or
// ability damage ratios are inferred from champion class labels.
const CONVERSIONS = [
  {id:1205,key:'ARAM_ADAPt',words:['额外攻击力转化为法术强度'],from:'ad',to:'ap',fromLabel:'装备攻击力',toLabel:'法术强度'},
  {id:1206,key:'ARAM_escAPADe',words:['法术强度转化为额外攻击力'],from:'ap',to:'ad',fromLabel:'装备法术强度',toLabel:'额外攻击力'},
  {id:2018,key:'ARAM_Purist_Caster',words:['所有攻击速度转化为技能急速'],from:'attackSpeed',to:'haste',fromLabel:'装备攻击速度',toLabel:'技能急速'},
  {id:3018,key:'BigShot',words:['75%攻击速度转化为暴击伤害'],from:'attackSpeed',to:'critDamage',fromLabel:'装备攻击速度',toLabel:'暴击伤害',partial:true},
  {id:3063,key:'GiftoftheDrowned',words:['额外生命值转化为穿甲'],from:'health',to:'lethality',fromLabel:'装备额外生命值',toLabel:'穿甲'},
  {id:3059,key:'NoManaNoProblem',words:['来自你的装备的法力值转化为法术强度'],from:'mana',to:'ap',fromLabel:'装备法力值',toLabel:'法术强度'},
  {id:3058,key:'TickleMonster',words:['攻击力转化为攻击速度','普攻附带额外魔法伤害攻击特效'],from:'ad',to:'attackSpeed',fromLabel:'装备攻击力',toLabel:'攻击速度'},
];
const ULTIMATE_DEPENDENCIES = [
  {id:3055,key:'UltimateRecursion',words:['终极技能急速']},
  {id:1349,key:'UltimateAwakening',words:['施放你的终极技能后']},
  {id:1344,key:'FinalForm',words:['施放你的终极技能时']},
  {id:1211,key:'ARAM_ItsKillingTime',words:['施放你的终极技能后']},
  {id:1088,key:'ARAM_UltimateRevolution',words:['施放终极技能后刷新你的终极技能']},
  {id:1011,key:'ARAM_CantTouchThis',words:['施放你的终极技能会']},
  {id:1112,key:'ARAM_UltimateUnstoppable',words:['使用你的终极技能后']},
  {id:1194,key:'ARAM_FeyMagic',words:['你的终极技能的伤害']},
  {id:1413,key:'ARAM_StuckInHereWithMe',words:['使用你的终极技能时']},
  {id:3118,key:'ArcaneAxiom',words:['返还你终极技能的部分总冷却时间']},
  {id:2134,key:'SurgeField',words:['施放终极技能时']},
];
module.exports={CONVERSIONS,ULTIMATE_DEPENDENCIES};
