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
// The stat is the owner's input to an explicitly described mechanic. Merely
// mentioning a target's maximum health never qualifies as own-health scaling.
const SCALING_RULES = [
  {id:1030,key:'ARAM_Eureka',words:['法术强度的技能急速'],stat:'ap',effect:'法术强度可继续供给技能急速'},
  {id:1180,key:'ARAM_BigBrain',words:['每拥有1法术强度就会获得3护盾值'],stat:'ap',effect:'法术强度可供给该强化的护盾；刷新条件仍按强化说明'},
  {id:2009,key:'ARAM_Zealot',words:['暴击几率','攻击速度（随法术强度变化）'],stat:'ap',effect:'法术强度参与该强化的暴击和攻速变化；未读取具体换算量'},
  {id:1056,key:'ARAM_MindtoMatter',words:['最大生命值提升','一半的法力值'],stat:'mana',effect:'法力值可供给该强化的最大生命值提升'},
  {id:1311,key:'ARAM_Overflow',words:['法力消耗翻倍','基于你的最大法力值'],stat:'mana',effect:'最大法力值参与技能增益；同时要承担翻倍的法力消耗'},
  {id:1181,key:'ARAM_HeavyHitter',words:['相当于你3.5%最大生命值'],stat:'health',effect:'自身最大生命值参与普攻附加伤害；仍需要实际普攻命中'},
  {id:2102,key:'PressureCooker',words:['受益于你的最大生命值'],stat:'health',effect:'自身最大生命值参与附近灼烧；需要接近对手'},
  {id:1020,key:'ARAM_DawnbringersResolve',words:['回复共30%最大生命值'],stat:'health',effect:'自身最大生命值参与低血量回复；触发与重置仍按强化说明'},
  {id:1344,key:'FinalForm',words:['施放你的终极技能时','最大生命值护盾'],stat:'health',effect:'自身最大生命值参与终极技能后的护盾；仍需要可用终极技能'},
];
const CRIT_MECHANICS = [
  {id:1048,key:'ARAM_JeweledGauntlet',words:['技能可以造成暴击'],effect:'技能暴击'},
  {id:3123,key:'JeweledBracelet',words:['技能可以暴击'],effect:'指定技能暴击'},
  {id:1118,key:'ARAM_CriticalHealing',words:['治疗和护盾可以暴击'],effect:'治疗和护盾暴击'},
  {id:2010,key:'ARAM_DoubleTap',words:['暴击施加一次额外的攻击特效'],effect:'暴击时额外触发攻击特效'},
  {id:1328,key:'CriticalRhythm',words:['普攻在暴击时获得可叠加的攻击速度'],effect:'普攻暴击叠加攻速'},
  {id:1356,key:'CriticalMissile',words:['当你暴击时，发射飞弹'],effect:'暴击触发飞弹'},
  {id:1077,key:'ARAM_SoulSiphon',words:['暴击造成伤害的12%会等额治疗你自身'],effect:'暴击伤害自我治疗'},
  {id:1092,key:'ARAM_Vulnerability',words:['装备效果和持续伤害效果可以暴击'],effect:'装备和持续伤害暴击'},
];
const matchesRule=(augment,rule)=>augment?.id===rule.id&&augment.key===rule.key&&typeof augment.description==='string'&&rule.words.every(word=>augment.description.replace(/\s/g,'').includes(word.replace(/\s/g,'')));
module.exports={CONVERSIONS,ULTIMATE_DEPENDENCIES,SCALING_RULES,CRIT_MECHANICS,matchesRule};
