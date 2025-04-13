<?php
$servername = "localhost";
$username = "root";  
$password = ""; 
$dbname = "sql_database_edoc"; 

$database = new mysqli($servername, $username, $password, $dbname);

if ($database->connect_error) {
    die("Error! connection failed" . $database->connect_error);
}
?>

