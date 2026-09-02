import type{RequestHandler}from'express';import*as service from'../services/advanced-analytics.service.js';
export const search:RequestHandler=async(req,res)=>res.json({data:await service.searchInsights(req.auth!.userId,Number(req.query.days||30))});
export const inventory:RequestHandler=async(req,res)=>res.json({data:await service.inventoryIntelligence(req.auth!.userId)});
export const districts:RequestHandler=async(req,res)=>res.json({data:await service.districtAnalytics(req.auth!.userId,Number(req.query.days||30))});
export const csv:RequestHandler=async(req,res)=>{const value=await service.productCsv(req.auth!.userId,Number(req.query.days||30),typeof req.query.q==='string'?req.query.q:'');res.setHeader('content-type','text/csv; charset=utf-8');res.setHeader('content-disposition','attachment; filename="joharhaat-product-analytics.csv"');res.send(`\uFEFF${value.csv}`)};
export const aggregate:RequestHandler=async(_req,res)=>res.json({data:await service.aggregateAnalytics()});
