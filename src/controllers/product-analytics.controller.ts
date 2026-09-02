import type {RequestHandler} from 'express';import {recordEvent,listProductAnalytics,productAnalyticsDetail} from '../services/product-analytics.service.js';
export const ingest:RequestHandler=async(req,res)=>res.status(201).json({data:await recordEvent(req.body)});
export const list:RequestHandler=async(req,res)=>res.json({data:await listProductAnalytics(req.auth!.userId,{days:Number(req.query.days||30),...(typeof req.query.q==='string'?{q:req.query.q}:{})})});
export const detail:RequestHandler=async(req,res)=>res.json({data:await productAnalyticsDetail(req.auth!.userId,String(req.params.id),Number(req.query.days||30))});
