import{aF as R,I as P,ai as X,z as i,d as A,t as D,v as B,l as U,ah as $,b as F,y as J,x as L,m as k,g as m,s as h,p as q,q as z,W as K,E as W}from"./index-CcWaFW2J.js";import{P as Y,p as G}from"./index-BdLjdNYg.js";import{o as H}from"./dialog-luBO2yFS.js";/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var Q={delay:{type:Number},destroyOnClose:{type:Boolean,default:!0},duration:{type:Number},placement:{type:String,default:"top"},showArrow:{type:Boolean,default:!0},theme:{type:String,default:"default",validator:function(e){return e?["default","primary","success","danger","warning","light"].includes(e):!0}}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var Z=function(){var e=i(0),n=i(0),t=function(v){e.value=v.clientX,n.value=v.clientY};return R||(P(function(){window.addEventListener("mousemove",t,{passive:!0})}),X(function(){window.removeEventListener("mousemove",t)})),{x:e,y:n}};/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */function w(r,e){var n=Object.keys(r);if(Object.getOwnPropertySymbols){var t=Object.getOwnPropertySymbols(r);e&&(t=t.filter(function(s){return Object.getOwnPropertyDescriptor(r,s).enumerable})),n.push.apply(n,t)}return n}function l(r){for(var e=1;e<arguments.length;e++){var n=arguments[e]!=null?arguments[e]:{};e%2?w(Object(n),!0).forEach(function(t){h(r,t,n[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(r,Object.getOwnPropertyDescriptors(n)):w(Object(n)).forEach(function(t){Object.defineProperty(r,t,Object.getOwnPropertyDescriptor(n,t))})}return r}var ee=A({name:"TTooltip",props:l(l({},G),Q),setup:function(e,n){var t=i(null),s=i(null),v=L(e),O=v.visible,S=v.modelValue,V=D(O,S,e.defaultVisible,e.onVisibleChange,"visible"),p=B(V,2),C=p[0],y=p[1],c=K(),f=i(e.visible||e.defaultVisible),b=U(),T=k(),j=q(),_=Z(),g=_.x,d=i(g.value);P(function(){e.duration&&f.value&&(t.value=setTimeout(function(){y(!1,{}),clearTimeout(t.value),t.value=null},e.duration))});var I=function(a,o){t.value&&(o==null?void 0:o.trigger)!=="document"||(a&&(d.value=g.value),y(a,o))},M=m(function(){return["".concat(b.value,"-tooltip"),h({},"".concat(b.value,"-tooltip--").concat(e.theme),e.theme),e.overlayClassName]}),N=m(function(){return l(l({},(c==null?void 0:c.vnode.props)||{}),{},{placement:e.placement==="mouse"?"bottom-left":e.placement,showArrow:e.placement==="mouse"?!1:e.showArrow,overlayClassName:M.value,onVisibleChange:I,disabled:e.disabled})}),x=m(function(){if(e.placement!=="mouse"||d.value===0)return e.overlayInnerStyle;var u=function(o){return{transform:"translateX(".concat(d.value-o.getBoundingClientRect().left,"px)")}};return e.overlayInnerStyle?function(a,o){return l(l({},u(a)),z(e.overlayInnerStyle)?e.overlayInnerStyle(a,o):e.overlayInnerStyle)}:u});$(function(){return f.value},function(){t.value&&!f.value&&(clearTimeout(t.value),t.value=null)});var E=function(){var a,o;(a=s.value)===null||a===void 0||(o=a.update)===null||o===void 0||o.call(a)};return n.expose({updatePopper:E}),function(){var u=T("content");return F(Y,J(H(N.value,["content","default"]),{ref:s,hideEmptyPopup:!0,overlayInnerStyle:x.value,visible:C.value}),l({default:function(){return[j("default","triggerElement")]}},!u&&!e.content?{}:{content:function(){return u}}))}}});/**
 * tdesign v1.18.5
 * (c) 2026 tdesign
 * @license MIT
 */var oe=W(ee);export{oe as T};
