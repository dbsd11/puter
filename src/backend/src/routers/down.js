/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
"use strict"
const express = require('express');
const router = express.Router();
const config = require('../config.js');
const { DB_WRITE } = require('../services/database/consts.js');
const { NodePathSelector } = require('../filesystem/node/selectors.js');
const { HLRead } = require('../filesystem/hl_operations/hl_read.js');
const { UserActorType } = require('../services/auth/Actor.js');
const configurable_auth = require('../middleware/configurable_auth.js');

// -----------------------------------------------------------------------//
// GET /down
// -----------------------------------------------------------------------//
router.post('/down', express.json(), express.urlencoded({ extended: true }), configurable_auth(), async (req, res, next)=>{
    // check subdomain
    const actor = req.actor;

    if ( ! actor || !(actor.type instanceof UserActorType) ) {
        if(require('../helpers').subdomain(req) !== 'api')
            next();
    }

    // check if user is verified
    if((config.strict_email_verification_required || req.user.requires_email_confirmation) && !req.user.email_confirmed) {
        console.log('account is not verified');
        return res.status(400).send({code: 'account_is_not_verified', message: 'Account is not verified'});
    }

    // check anti-csrf token
    const svc_antiCSRF = req.services.get('anti-csrf');
    if ( ! svc_antiCSRF.consume_token(req.user.uuid, req.body.anti_csrf) ) {
        console.log('incorrect anti-CSRF token');
        return res.status(400).json({ message: 'incorrect anti-CSRF token' });
    }

    // validation
    if(!req.query.path) {
        console.log('path is required');
        return res.status(400).send('path is required')
    }
    // path must be a string
    else if (typeof req.query.path !== 'string') {
        console.log('path must be a string.');
        return res.status(400).send('path must be a string.')
    }
    else if(req.query.path.trim() === '') {
        console.log('path cannot be empty');
        return res.status(400).send('path cannot be empty')
    }

    // modules
    const db = req.services.get('database').get(DB_WRITE, 'filesystem');
    const _path = require('path');
    const {chkperm} = require('../helpers')
    const path       = _path.resolve('/', req.query.path);
    const AWS        = require('aws-sdk');

    // cannot download the root, because it's a directory!
    if(path === '/') {
        console.log('Cannot download the root.');
        return res.status(400).send('Cannot download a directory.');
    }

    // resolve path to its FSEntry
    const svc_fs = req.services.get('filesystem');
    const fsnode = await svc_fs.node(new NodePathSelector(path));

    // not found
    if( ! fsnode.exists() ) {
        console.log('File not found');
        return res.status(404).send('File not found');
    }

    // stream data from S3
    try{
        const esc_filename = (await fsnode.get('name'))
            .replace(/[^a-zA-Z0-9-_\.]/g, '_');
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.attachment(await fsnode.get('name'));

        let size = await fsnode.fetchSize();
        res.setHeader('Content-Length', size);

        const hl_read = new HLRead();
        const stream = await hl_read.run({
            fsNode: fsnode,
            user: req.user,
        });

        // let stream = await s3.getObject({
        //     Bucket: fsentry.bucket,
        //     Key: fsentry.uuid, // File name you want to save as in S3
        // }).createReadStream().on('error', error => {
        //     console.log(error);
        // });
        return stream.pipe(res);
    }catch(e){
        console.log(e);
        return res.type('application/json').status(500).send({message: 'There was an internal problem reading the file.'});
    }
})

module.exports = router
