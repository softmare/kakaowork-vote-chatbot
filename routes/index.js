// routes/index.js
const express = require('express')
const router = express.Router()

const libKakaoWork = require('../libs/kakaoWork')
// messages
const first_message = require('./messages/first_message')
const create_vote_callback = require('./messages/create_vote_callback')
const start_vote = require('./messages/start_vote.js')
const plz_vote = require('./messages/plz_vote.js')
const end_vote = require('./messages/end_vote.js')
const alert_create_room = require('./messages/alert_create_room')
// modals
const alert_check_vote = require('./modals/alert_check_vote')
const alert_create_vote = require('./modals/alert_create_vote')
const create_vote = require('./modals/create_vote')
const create_vote_choice = require('./modals/create_vote_choice')
const go_vote = require('./modals/go_vote')
const go_vote_duplicated = require('./modals/go_vote_duplicated')
const check_vote = require('./modals/check_vote')
const check_vote_admin = require('./modals/check_vote_admin')
const closed_vote = require('./modals/closed_vote')
// db
const sqlite3 = require('sqlite3').verbose()
const query = require('../db/query')

const force_init = false
const db = new sqlite3.Database('./db/my.db', sqlite3.OPEN_READWRITE, (err) => {
	if (err) {
		console.error(err.message)
	} else {
		console.log('Connected to the mydb database.')
	}
})
const foreign_keys = 'PRAGMA foreign_keys = ON'
db.serialize(() => {
	// init
	db.each(foreign_keys)
})
if (force_init) {
	db.serialize(() => {
		// drop and create table
		db.each(query.dropVoteDetail)
		db.each(query.dropVoteUser)
		db.each(query.dropUser)
		db.each(query.dropVote)
	})
}
db.serialize(() => {
	db.each(query.createUser)
	db.each(query.createVote)
	db.each(query.createVoteUser)
	db.each(query.createVoteDetail)
})

// 디비가 없으면 생성 (force_init == true) 면 있어도 생성.

router.get('/', async (req, res, next) => {
	const succeed = true
	const users = await libKakaoWork.getUserList()
	const conversations = await Promise.all(
		users.map((user) => {
			db.serialize(() => {
				db.each(`INSERT INTO user(id, making, making_vote_title, making_choice_number)
SELECT * FROM (SELECT '${user.id}', 0, null, null)
WHERE NOT EXISTS (
SELECT id FROM user WHERE id = '${user.id}'
)`)
			})
			return (libKakaoWork.openConversations({
				userId: user.id
			}))
		})
	)
	const messages = await Promise.all([
		conversations.map((conversation) => {

			libKakaoWork.sendMessage(
				first_message(conversation.id)
			)
		})
	])

	res.json({
		force_init: force_init,
		succeed: succeed
	})
})

router.post('/request', async (req, res, next) => {
	const {
		message,
		actions,
		action_time,
		value,
		react_user_id
	} = req.body
	switch (value) {
		// 1.2
		case 'create_vote':
			db.serialize()
			db.all(`SELECT * FROM user WHERE id=${react_user_id}`, [], async (err, data) => {
				if (err) {
					throw err
				}
				if (data[0].making) {
					return res.json({
						view: alert_create_vote()
					})
				} else {
					return res.json({
						view: create_vote()
					})
				}
			})
			break
		case 'create_vote_choice':
			db.serialize()
			db.all(`SELECT * FROM user WHERE id=${react_user_id}`, (err, row) => {
				return res.json({
					view: create_vote_choice(row[0].making_choice_number)
				})
			})
			break


		case 'go_vote':
			db.serialize()
			db.each(`SELECT status FROM vote WHERE conversation_id = ${message.conversation_id}`, (err, row) => {
				if (row.status == 0) {
					return res.json({
						view: closed_vote()
					})
				} else {
					db.all(`SELECT * from vote as v, vote_detail as vd
WHERE v.conversation_id=${message.conversation_id} and 
vd.conversation_id=${message.conversation_id}`, (err, row) => {
						var tmp = row
						for (var k in row) {
							tmp[k].id = String(row[k].id)
						}
						if (row[0].duplicated_check) {
							return res.json({
								view: go_vote_duplicated(tmp)
							})
						} else {
							return res.json({
								view: go_vote(tmp)
							})
						}
					})
				}
			})

			break
		case 'close_vote':
			await libKakaoWork.kickUser({
				user_id: react_user_id,
				conversation_id: message.conversation_id
			})
			break
		case 'check_vote':

			db.serialize()
			db.each(`SELECT status FROM vote WHERE conversation_id = ${message.conversation_id}`, (err, row) => {
				if (row.status == 0) {
					return res.json({
						view: closed_vote()
					})
				} else {
					db.all(`SELECT vote_title, host_id, vd.choice as c1, vu.choice as c2, vd.id as id1, vu.choice_id as id2 FROM vote as v, (vote_detail as vd LEFT OUTER JOIN vote_user as vu) as vc
WHERE v.conversation_id=${message.conversation_id} and
vd.conversation_id=${message.conversation_id}
`, (err, row) => {
						if (row.length == 0) {
							res.json({
								view: alert_check_vote(row)
							})
						} else if (row[0].host_id == react_user_id) {
							res.json({
								view: check_vote_admin(row)
							})
						} else {
							res.json({
								view: check_vote(row)
							})
						}

					})
				}
			})
			break
		default:
			res.json({
				result: true
			})
	}
})
// routes/index.js
router.post('/callback', async (req, res, next) => {
	const {
		message,
		actions,
		action_time,
		value,
		react_user_id
	} = req.body // 설문조사 결과 확인 (2)
	switch (value) {
		case 'cancel_vote':
			db.serialize(() => {
				db.each(`SELECT * FROM user WHERE id=${react_user_id}`, [], (err, data) => {
					if (err) {
						throw err
					}
					db.serialize(() => {
						db.each(`UPDATE user 
set making=0
WHERE id = ${Number(react_user_id)}`)
					})
				})
			})
			await libKakaoWork.sendMessage(
				first_message(message.conversation_id)
			)
			return res.json({
				result: true
			})

		case 'create_vote_callback':
			db.serialize(() => {
				db.each(`UPDATE user set making=1, making_vote_title='${actions.vote_title}', making_choice_number=${Number(actions.choice_number)}, duplicated_check = ${Number(actions.duplicated_check)}, vote_period = ${Number(actions.vote_period)} WHERE id = ${Number(react_user_id)}`)
			})
			var duplicated = ''
			if (Number(actions.duplicated_check) == 1) {
				duplicated = '가능'
			} else {
				duplicated = '불가능'
			}
			await libKakaoWork.sendMessage(
				create_vote_callback(message.conversation_id, actions.vote_title, actions.choice_number, duplicated)
			)
			break
		case 'alert_create_vote_callback':
			db.serialize()
			db.all(`SELECT * FROM user WHERE id=${react_user_id}`, async (err, data) => {
				var duplicated = ''
				if (data[0].duplicated_check == 1) {
					duplicated = '가능'
				} else {
					duplicated = '불가능'
				}
				await libKakaoWork.sendMessage(
					create_vote_callback(message.conversation_id, data[0].making_vote_title, data[0].making_choice_number, duplicated)
				)
			})
			break
		case 'do_admin':
			const admin_mode = actions.admin_mode
			if (admin_mode == 'end_vote') {
				db.serialize()
				db.all(`SELECT vote_title, host_id, vd.choice as c1, vu.choice as c2, vd.id as id1, vu.choice_id as id2 FROM vote as v, (vote_detail as vd LEFT OUTER JOIN vote_user as vu) as vc
WHERE v.conversation_id=${message.conversation_id} and
vd.conversation_id=${message.conversation_id}
`, async (err, row) => {
					db.each(`UPDATE vote SET status = 0 WHERE conversation_id = ${message.conversation_id}`)
					await libKakaoWork.sendMessage(
						end_vote(message.conversation_id, row)
					)
				})
			} else if (admin_mode == 'plz_vote') {
				db.serialize()
				db.all(`SELECT vt.choice, vote_title, end_date FROM vote_detail as vt, vote as v
WHERE v.conversation_id = ${message.conversation_id} and
vt.conversation_id = ${message.conversation_id}`, async (err, rows) => {
					const conversation_id = message.conversation_id
					const vote_title = rows[0].vote_title
					const choices = {}
					for (i in rows) {
						data = rows[i]
						choices['선택지 ' + `${i}`] = data.choice
					};
					const period = rows[0].end_date + 9 * 60 * 60 * 1000
					const end_date = new Date(period)
					await libKakaoWork.sendMessage(
						plz_vote(conversation_id, choices, vote_title, end_date.toISOString().slice(0, 19).replace('T', ' '))
					)
				})
			}
			break

		case 'do_vote':
			db.serialize(() => {
				db.each(`DELETE FROM vote_user WHERE conversation_id = ${message.conversation_id} and user_id=${react_user_id}`)
				db.each(`SELECT duplicated_check FROM vote WHERE conversation_id = ${message.conversation_id}`, (err, data) => {
					db.serialize(() => {
						if (data.duplicated_check == 1) {
							for (key in actions)
								if (actions[key] != 0) {
									var choice_id = Number(key)
									var choice = db.each(`SELECT choice FROM vote_detail WHERE id='${choice_id}'`, (err, row) => {
										return row
									})
									db.each(`INSERT INTO vote_user(conversation_id, user_id, choice, choice_id) 
								values(${message.conversation_id}, ${react_user_id}, '${choice}', '${key}')`)
								}
						} else {
							var choice_id = Number(actions.choice_id)
							var choice = db.each(`SELECT choice FROM vote_detail WHERE id='${choice_id}'`, (err, row) => {
								return row
							})
							db.each(`INSERT INTO vote_user(conversation_id, user_id, choice, choice_id) values(${message.conversation_id}, ${react_user_id}, '${choice}', '${choice_id}')`)
						}
					})
				})
			})

			break
		case 'create_vote_done':
			db.serialize(() => {
				db.each(`SELECT * FROM user WHERE id=${react_user_id}`, [], (err, data) => {
					if (err) {
						throw err
					}
					db.serialize(() => {
						db.each(`UPDATE user 
set making=0
WHERE id = ${Number(react_user_id)}`)
					})
				})
			})

			const group_info = await libKakaoWork.openGroupConversations({
				userIds: [react_user_id]
			})
			db.all(`SELECT * FROM user WHERE id=${react_user_id}`, async (err, data) => {
				const vote_title = data[0].making_vote_title
				const choice_number = data[0].making_choice_number
				const host_id = react_user_id
				const conversation_id = group_info.id
				const duplicated_check = data[0].duplicated_check
				const status = 1
				const period = Date.now() + data[0].vote_period * 60 * 60 * 1000
				const end_date = new Date(period)
				var schedule = require('node-schedule')
				var j = schedule.scheduleJob(end_date, function(){
					db.serialize()
					db.all(`SELECT vote_title, host_id, vd.choice as c1, vu.choice as c2, vd.id as id1, vu.choice_id as id2 FROM vote as v, (vote_detail as vd LEFT OUTER JOIN vote_user as vu) as vc
WHERE v.conversation_id=${conversation_id} and
vd.conversation_id=${conversation_id}
`, async (err, row) => {
					db.each(`UPDATE vote SET status = 0 WHERE conversation_id = ${conversation_id}`)
					await libKakaoWork.sendMessage(
						end_vote(conversation_id, row)
					)
				})
				});
				db.each(`INSERT INTO vote(conversation_id, vote_title, choice_number, host_id, duplicated_check, status, end_date) 
SELECT * FROM (SELECT ${conversation_id}, '${vote_title}', ${choice_number}, ${host_id}, ${duplicated_check}, ${status}, ${period})
WHERE NOT EXISTS (
SELECT conversation_id FROM vote WHERE conversation_id = ${conversation_id}
)`)
			})
			for (key in actions) {
				db.each(`INSERT INTO vote_detail(conversation_id, choice) 
VALUES (${group_info.id}, '${actions[key]}')`)
			}
			db.all(`SELECT * FROM user WHERE id=${react_user_id}`, async (err, data) => {
				const vote_title = data[0].making_vote_title
				const conversation_id = group_info.id
				const period = Date.now() + data[0].vote_period * 60 * 60 * 1000 + 9 * 60 * 60 * 1000
				const end_date = new Date(period)
				const message = start_vote(conversation_id, actions, vote_title, end_date.toISOString().slice(0, 19).replace('T', ' '))
				await libKakaoWork.sendMessage(
					message
				)
			})

			await libKakaoWork.sendMessage(
				alert_create_room(message.conversation_id)
			)
			await libKakaoWork.sendMessage(
				first_message(message.conversation_id)
			)
			break
		default:
	}

	res.json({
		result: true
	})
})
module.exports = router