const express = require("express");
const session = require("express-session");
const path = require("path");
const app = express();
const cors = require("cors");

app.use(
  cors({
    origin: "https://www.codeadventure.shop",
    credentials: true,
  })
);

const port = 3001;

// const db = require("./lib/db"); // 데이터베이스 연결
const sessionOption = require("./lib/sessionOption"); // 세션 옵션
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");

app.use(express.static(path.join(__dirname, "/build"))); // 정적 파일 경로 설정
app.use(bodyParser.urlencoded({ extended: false })); // URL-encoded 데이터 파싱 설정
app.use(bodyParser.json()); // JSON 데이터 파싱 설정

var MySQLStore = require("express-mysql-session")(session); // MySQL 세션 스토어 설정
var sessionStore = new MySQLStore(sessionOption);
app.use(
  session({
    key: "session_cookie_name",
    secret: "~",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
  })
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "/build/index.html")); // 메인 페이지 서빙
});

app.get("/authcheck", (req, res) => {
  const sendData = { isLogin: "" };
  if (req.session.is_logined) {
    sendData.isLogin = "True";
  } else {
    sendData.isLogin = "False";
  }
  res.send(sendData); // 로그인 상태 확인
});

app.get("/users", (req, res) => {
  if (req.session.is_manager) {
    db.query(
      "SELECT id, username, email, phone, coin, experience, cst, javast, pythonst, jsst, htmlst, cssst, level FROM users",
      (error, results, fields) => {
        if (error) {
          console.error("Database query error:", error);
          return res.status(500).json({ error: "Database query error" });
        }
        res.json(results); // 모든 사용자 정보 조회 (관리자만 가능)
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" }); // 권한 없는 사용자에 대한 응답
  }
});

app.get("/check-language-start", (req, res) => {
  const language = req.query.language;
  const progressField = `${language}st`;

  if (req.session.is_logined) {
    db.query(
      `SELECT ${progressField} FROM users WHERE username = ?`,
      [req.session.nickname],
      (error, results, fields) => {
        if (error) throw error;
        const userProgress = results[0][progressField];
        res.json({ startPage: userProgress === 0 }); // 사용자가 해당 언어 학습을 처음 시작하는지 확인
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/userinfo", (req, res) => {
  if (req.session.is_logined) {
    db.query(
      "SELECT username, email, phone, coin, experience, cst, javast, pythonst, jsst, htmlst, cssst, level FROM users WHERE username = ?",
      [req.session.nickname],
      function (error, results, fields) {
        if (error) throw error;
        if (results.length > 0) {
          res.send(results[0]); // 사용자 정보 조회
        } else {
          res.status(404).json({ error: "User not found" });
        }
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/stages", (req, res) => {
  if (req.session.is_logined) {
    const language = req.query.language;
    const quizTable = `${language}quiz`; // 동적으로 테이블 이름 설정
    const progressField = `${language}st`;

    db.query(
      `SELECT ${progressField} FROM users WHERE username = ?`,
      [req.session.nickname],
      function (error, results, fields) {
        if (error) throw error;
        const userProgress = results[0][progressField];
        db.query(
          `SELECT id FROM ${quizTable}`,
          function (error, results, fields) {
            if (error) throw error;
            res.json({ stages: results, userProgress }); // 사용자의 진행 상태와 함께 모든 스테이지 ID 조회
          }
        );
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/quiz/:stageId", (req, res) => {
  const stageId = req.params.stageId;
  const language = req.query.language;
  if (!language) {
    return res
      .status(400)
      .json({ error: "Language query parameter is required" });
  }
  const quizTable = `${language}quiz`; // 동적으로 테이블 이름 설정

  db.query(
    `SELECT * FROM ${quizTable} WHERE id = ?`,
    [stageId],
    function (error, results, fields) {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ error: "Database query error" });
      }
      if (results.length > 0) {
        res.json(results[0]); // 특정 ID의 퀴즈 데이터 조회
      } else {
        res.status(404).json({ error: "Quiz not found" });
      }
    }
  );
});

app.post("/submit-answer", (req, res) => {
  const { stageId, answers, answerKeys, language } = req.body;
  const quizTable = `${language}quiz`;
  const progressField = `${language}st`;

  if (req.session.is_logined) {
    db.query(
      `SELECT ${answerKeys.join(", ")} FROM ${quizTable} WHERE id = ?`,
      [stageId],
      function (error, results, fields) {
        if (error) throw error;
        if (results.length > 0) {
          const correctAnswers = answerKeys.map(
            (key, index) => results[0][key] === answers[index]
          );
          const allCorrect = correctAnswers.every((correct) => correct);

          if (allCorrect) {
            db.query(
              `SELECT ${progressField}, experience, level FROM users WHERE username = ?`,
              [req.session.nickname],
              function (error, results, fields) {
                if (error) throw error;
                const userProgress = results[0][progressField];
                const currentExperience = results[0].experience;
                const currentLevel = results[0].level;
                const newExperience =
                  currentExperience + (userProgress < stageId ? 50 : 0); // 경험치 획득
                let newLevel = currentLevel;

                const requiredExperience = 200 * Math.pow(2, newLevel - 1);

                let levelUp = false;
                if (newExperience >= requiredExperience) {
                  newLevel += 1;
                  levelUp = true;
                }

                let updateQuery = `UPDATE users SET experience = ?, level = ? WHERE username = ?`;
                if (userProgress < stageId) {
                  updateQuery = `UPDATE users SET ${progressField} = ${progressField} + 1, coin = coin + 50, experience = ?, level = ? WHERE username = ?`;
                }

                db.query(
                  updateQuery,
                  [newExperience, newLevel, req.session.nickname],
                  function (error, results, fields) {
                    if (error) throw error;

                    if (levelUp) {
                      db.query(
                        `UPDATE users SET experience = 0, coin = coin + 500 WHERE username = ?`,
                        [req.session.nickname],
                        function (error, results, fields) {
                          if (error) throw error;
                          res.json({
                            correct: true,
                            firstTime: userProgress < stageId,
                            levelUp,
                            newLevel,
                            correctAnswers,
                          });
                        }
                      );
                    } else {
                      res.json({
                        correct: true,
                        firstTime: userProgress < stageId,
                        levelUp,
                        newLevel,
                        correctAnswers,
                      });
                    }
                  }
                );
              }
            );
          } else {
            res.json({ correct: false, correctAnswers }); // 정답이 아닌 경우
          }
        } else {
          res.status(404).json({ error: "Quiz not found" });
        }
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/logout", function (req, res) {
  req.session.destroy(function (err) {
    res.redirect("/"); // 로그아웃 처리
  });
});

app.post("/login", (req, res) => {
  const username = req.body.userId;
  const password = req.body.userPassword;
  const sendData = { isLogin: "", isManager: false, isNewUser: false };

  if (username && password) {
    if (username === "root" && password === "1234") {
      req.session.is_logined = true;
      req.session.nickname = username;
      req.session.is_manager = true;
      req.session.save(function () {
        sendData.isLogin = "True";
        sendData.isManager = true;
        res.send(sendData);
      });
    } else {
      db.query(
        "SELECT * FROM users WHERE username = ?",
        [username],
        function (error, results, fields) {
          if (error) throw error;
          if (results.length > 0) {
            bcrypt.compare(password, results[0].password, (err, result) => {
              if (result === true) {
                const isNewUser = results[0].last_login === null;
                req.session.is_logined = true;
                req.session.nickname = username;
                req.session.save(function () {
                  sendData.isLogin = "True";
                  sendData.isNewUser = isNewUser;
                  res.send(sendData);
                });
                // Update the last_login timestamp
                db.query(
                  `UPDATE users SET last_login = NOW() WHERE username = ?`,
                  [username],
                  function (error, result) {
                    if (error)
                      console.error("Error updating last_login:", error);
                  }
                );
                // Log the login action
                db.query(
                  `INSERT INTO logTable (created, username, action, command, actiondetail) VALUES (NOW(), ?, 'login', ?, ?)`,
                  [username, "-", `React 로그인 테스트`],
                  function (error, result) {
                    if (error)
                      console.error("Error logging login action:", error);
                  }
                );
              } else {
                sendData.isLogin = "로그인 정보가 일치하지 않습니다.";
                res.send(sendData);
              }
            });
          } else {
            sendData.isLogin = "아이디 정보가 일치하지 않습니다.";
            res.send(sendData);
          }
        }
      );
    }
  } else {
    sendData.isLogin = "아이디와 비밀번호를 입력하세요!";
    res.send(sendData);
  }
});

app.post("/signin", (req, res) => {
  const username = req.body.userId;
  const password = req.body.userPassword;
  const password2 = req.body.userPassword2;
  const email = req.body.email;
  const phone = req.body.phone;

  const sendData = { isSuccess: "" };

  if (username && password && password2 && email && phone) {
    db.query(
      "SELECT * FROM users WHERE username = ?",
      [username],
      function (error, results, fields) {
        if (error) throw error;
        if (results.length <= 0 && password == password2) {
          const hashedPassword = bcrypt.hashSync(password, 10);
          db.query(
            `INSERT INTO users (username, password, email, phone, coin, experience, cst, javast, pythonst, jsst, cssst, htmlst, level, last_login) 
                          VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, 1, NULL)`,
            [username, hashedPassword, email, phone],
            function (error, data) {
              if (error) throw error;
              req.session.save(function () {
                sendData.isSuccess = "True";
                res.send(sendData);
              });
            }
          );
        } else if (password != password2) {
          sendData.isSuccess = "입력된 비밀번호가 서로 다릅니다.";
          res.send(sendData);
        } else {
          sendData.isSuccess = "이미 존재하는 아이디 입니다!";
          res.send(sendData);
        }
      }
    );
  } else {
    sendData.isSuccess = "아이디, 비밀번호, 이메일, 전화번호를 입력하세요!";
    res.send(sendData);
  }
});

app.get("/managercheck", (req, res) => {
  const sendData = { isManager: false };
  if (req.session.is_manager) {
    sendData.isManager = true;
  }
  res.send(sendData);
});

app.get("/purchase-log", (req, res) => {
  if (req.session.is_manager) {
    db.query(
      "SELECT username, productname, phone FROM purchaseLog",
      (error, results, fields) => {
        if (error) throw error;
        res.json(results);
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.get("/shop", (req, res) => {
  db.query("SELECT * FROM codeadventure.shop", (error, results, fields) => {
    if (error) throw error;
    res.json(results);
  });
});

app.post("/purchase", (req, res) => {
  if (req.session.is_logined) {
    const { productId } = req.body;
    const username = req.session.nickname;

    db.query(
      "SELECT productprice, productamount, productname FROM codeadventure.shop WHERE id = ?",
      [productId],
      (error, results, fields) => {
        if (error) throw error;
        if (results.length > 0) {
          const product = results[0];
          if (product.productamount > 0) {
            db.query(
              "SELECT coin, phone FROM users WHERE username = ?",
              [username],
              (error, results, fields) => {
                if (error) throw error;
                if (results.length > 0) {
                  const user = results[0];
                  if (user.coin >= product.productprice) {
                    const newCoin = user.coin - product.productprice;
                    const newAmount = product.productamount - 1;

                    db.query(
                      "UPDATE users SET coin = ? WHERE username = ?",
                      [newCoin, username],
                      (error, results, fields) => {
                        if (error) throw error;
                        db.query(
                          "UPDATE codeadventure.shop SET productamount = ? WHERE id = ?",
                          [newAmount, productId],
                          (error, results, fields) => {
                            if (error) throw error;
                            db.query(
                              "INSERT INTO purchaseLog (username, productname, phone) VALUES (?, ?, ?)",
                              [username, product.productname, user.phone],
                              (error, results, fields) => {
                                if (error) throw error;
                                res.json({ success: true });
                              }
                            );
                          }
                        );
                      }
                    );
                  } else {
                    res.json({ success: false, message: "Not enough coins" });
                  }
                }
              }
            );
          } else {
            res.json({ success: false, message: "Product out of stock" });
          }
        } else {
          res.json({ success: false, message: "Product not found" });
        }
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.post("/update-quantity/:productId", (req, res) => {
  const { productId } = req.params;
  const { quantity } = req.body;

  if (req.session.is_manager) {
    db.query(
      "UPDATE codeadventure.shop SET productamount = ? WHERE id = ?",
      [quantity, productId],
      (error, results, fields) => {
        if (error) throw error;
        res.json({ success: true });
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.post("/purchase-hint", (req, res) => {
  if (req.session.is_logined) {
    const { stageId, language } = req.body;
    const quizTable = `${language}quiz`;

    db.query(
      "SELECT coin FROM users WHERE username = ?",
      [req.session.nickname],
      (error, results, fields) => {
        if (error) throw error;
        const user = results[0];
        if (user.coin >= 300) {
          db.query(
            "UPDATE users SET coin = coin - 300 WHERE username = ?",
            [req.session.nickname],
            (error, results, fields) => {
              if (error) throw error;
              db.query(
                `SELECT hint FROM ${quizTable} WHERE id = ?`,
                [stageId],
                (error, results, fields) => {
                  if (error) throw error;
                  if (results.length > 0) {
                    res.json({ success: true, hint: results[0].hint });
                  } else {
                    res
                      .status(404)
                      .json({ success: false, message: "Hint not found" });
                  }
                }
              );
            }
          );
        } else {
          res.json({ success: false, message: "Not enough coins" });
        }
      }
    );
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
