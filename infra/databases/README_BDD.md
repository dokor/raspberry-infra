-- Projet 1
CREATE DATABASE project1_db;
CREATE USER 'project1_user'@'%' IDENTIFIED BY 'project1_password';
GRANT ALL PRIVILEGES ON project1_db.* TO 'project1_user'@'%';

-- Projet 2
CREATE DATABASE project2_db;
CREATE USER 'project2_user'@'%' IDENTIFIED BY 'project2_password';
GRANT ALL PRIVILEGES ON project2_db.* TO 'project2_user'@'%';

FLUSH PRIVILEGES;
