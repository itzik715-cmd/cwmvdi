disable_mlock = true

controller {
  name = "kamvdi-controller"
  description = "KamVDI Boundary Controller"

  database {
    url = "env://BOUNDARY_POSTGRES_URL"
  }

  public_cluster_addr = "boundary"
}

worker {
  name = "kamvdi-worker"
  description = "KamVDI Boundary Worker"

  initial_upstreams = ["boundary:9201"]

  public_addr = "env://BOUNDARY_WORKER_PUBLIC_ADDR"
}

listener "tcp" {
  address = "0.0.0.0:9200"
  purpose = "api"
  tls_disable = true
}

listener "tcp" {
  address = "0.0.0.0:9201"
  purpose = "cluster"
  tls_disable = true
}

listener "tcp" {
  address = "0.0.0.0:9202"
  purpose = "proxy"
  tls_disable = true
}

kms "aead" {
  purpose   = "root"
  aead_type = "aes-gcm"
  key       = "sP1fnF5Xz85RrXMfaJHI2LKYfat0AHGFoQ5T/Y2vtsU="
  key_id    = "global_root"
}

kms "aead" {
  purpose   = "worker-auth"
  aead_type = "aes-gcm"
  key       = "IiBPPzKjjEfqp6Ss48RBhOMt3ex1kz8KUlNax3C8QgQ="
  key_id    = "global_worker-auth"
}

kms "aead" {
  purpose   = "recovery"
  aead_type = "aes-gcm"
  key       = "nIRSAsz/EqiRhsAb5U4x8vtPfn5WFKD6IR4g6Kfm5qA="
  key_id    = "global_recovery"
}
